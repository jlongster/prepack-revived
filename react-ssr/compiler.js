/**
 * Specializes React 18 server rendering of a known app for unknown data, with Prepack.
 *
 *   compile(appSource, { schema | samples, rootProp }) -> { code, render, diagnostics, stats }
 *
 * `render(data)` returns exactly ReactDOMServer.renderToString(<App {...{[rootProp]: data}} />)
 * for every `data` that conforms to the schema, without running React. See docs/revive/react.md.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

const RUNTIME_PATH = path.join(__dirname, "runtime.js");
const HELPERS_PATH = path.join(__dirname, "helpers.js");
const TABLES_PATH = path.join(__dirname, "dom-tables.part.js");

function loadModelSources() {
  const runtime = fs.readFileSync(RUNTIME_PATH, "utf8");
  const tables = fs.readFileSync(TABLES_PATH, "utf8");
  const helpers = fs.readFileSync(HELPERS_PATH, "utf8");
  return { runtime: runtime.replace("/*@@DOM_TABLES@@*/", () => tables), helpers };
}

// ------------------------------------------------------------------------------------------------
// App source transform: `createElement("tag", props, ..., xs.map(f), ...)` children become
// `__SSR.mapChildren(xs, f)`, so that the renderer can fuse rendering into the callback of a
// residual loop when the length of xs is unknown. Only children of host elements are rewritten: the
// mapped array never reaches user code there (host element children are only read by the renderer).

function transformApp(appSource) {
  const ast = babelParser.parse(appSource, { sourceType: "script", allowReturnOutsideFunction: true });
  let rewritten = 0;
  traverse(ast, {
    CallExpression(p) {
      const node = p.node;
      if (!isCreateElementCall(node)) return;
      if (node.arguments.length < 3 || !t.isStringLiteral(node.arguments[0])) return;
      for (let i = 2; i < node.arguments.length; i++) {
        const child = node.arguments[i];
        if (
          t.isCallExpression(child) &&
          t.isMemberExpression(child.callee) &&
          !child.callee.computed &&
          t.isIdentifier(child.callee.property, { name: "map" }) &&
          child.arguments.length >= 1 &&
          child.arguments.length <= 2 &&
          !child.arguments.some(a => t.isSpreadElement(a))
        ) {
          node.arguments[i] = t.callExpression(t.memberExpression(t.identifier("__SSR"), t.identifier("mapChildren")), [
            child.callee.object,
            ...child.arguments,
          ]);
          rewritten++;
        }
      }
    },
  });
  return { code: generate(ast, { retainLines: false, compact: false }).code, rewritten };
}

function isCreateElementCall(node) {
  const callee = node.callee;
  return (
    (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property, { name: "createElement" })) ||
    t.isIdentifier(callee, { name: "createElement" })
  );
}

// ------------------------------------------------------------------------------------------------
// Schemas. A schema is a JSON type description:
//   { kind: "string" | "number" | "boolean" | "undefined" | "null" }
//   { kind: "object", properties: { name: schema } }
//   { kind: "array", element: schema | undefined }
//   { kind: "union", variants: [schema] }
// inferSchema computes the least such type of a set of sample values (missing properties count as
// undefined). The schema is the contract of the generated code: data outside of it may render
// differently (see docs/revive/react.md).

function inferSchema(samples) {
  let acc;
  for (const s of samples) acc = mergeType(acc, typeOf(s));
  return acc;
}

function typeOf(v) {
  if (v === undefined) return { kind: "undefined" };
  if (v === null) return { kind: "null" };
  if (Array.isArray(v)) {
    let element;
    for (const e of v) element = mergeType(element, typeOf(e));
    return { kind: "array", element };
  }
  switch (typeof v) {
    case "string":
    case "number":
    case "boolean":
      return { kind: typeof v };
    case "object": {
      const properties = {};
      for (const k of Object.keys(v)) properties[k] = typeOf(v[k]);
      return { kind: "object", properties };
    }
    default:
      throw new Error("react-ssr: cannot infer a schema for a value of type " + typeof v);
  }
}

function variantsOf(type) {
  return type.kind === "union" ? type.variants : [type];
}

function mergeType(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const variants = variantsOf(a).slice();
  for (const v of variantsOf(b)) {
    const i = variants.findIndex(x => x.kind === v.kind);
    if (i < 0) variants.push(v);
    else variants[i] = mergeSameKind(variants[i], v);
  }
  return variants.length === 1 ? variants[0] : { kind: "union", variants };
}

function mergeSameKind(a, b) {
  if (a.kind === "array") return { kind: "array", element: mergeType(a.element, b.element) };
  if (a.kind === "object") {
    const properties = {};
    const keys = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
    for (const k of keys) {
      const pa = a.properties[k] || { kind: "undefined" };
      const pb = b.properties[k] || { kind: "undefined" };
      properties[k] = mergeType(pa, pb);
    }
    return { kind: "object", properties };
  }
  return a;
}

// Prepack shape descriptors (src/utils/ShapeInformation.js, extended with unions).
function toShapeDescriptor(type) {
  switch (type.kind) {
    case "string":
    case "number":
    case "boolean":
      return { kind: "scalar", jsType: type.kind };
    case "undefined":
      return { kind: "scalar", jsType: "void" };
    case "null":
      return { kind: "scalar", jsType: "null" };
    case "object": {
      const properties = {};
      for (const k of Object.keys(type.properties)) {
        properties[k] = { shape: toShapeDescriptor(type.properties[k]), optional: false };
      }
      return { kind: "object", jsType: "object", properties };
    }
    case "array":
      return {
        kind: "array",
        jsType: "array",
        elementShape: type.element === undefined ? undefined : { shape: toShapeDescriptor(type.element), optional: false },
      };
    case "union":
      return { kind: "union", jsType: "object", variants: type.variants.map(toShapeDescriptor) };
    default:
      throw new Error("react-ssr: unknown schema kind " + type.kind);
  }
}

// ------------------------------------------------------------------------------------------------
// Prepack input assembly

const PREPACK_HOST = `var __SSR_HOST = {
  isAbstract: function (v) { return __isAbstract(v); },
  types: function (v) { return __possibleTypes(v); },
  condParts: function (v) { return __conditionalParts(v); },
  str: function (f, a, b, c) { return __residual_unsafe("string", f, a, b, c); },
  bool: function (f, a, b) { return __residual_unsafe("boolean", f, a, b); },
  num: function (f, a, b, c) { return __residual_unsafe("number", f, a, b, c); },
  widen: function (a) { return __widenArray(a); },
  bail: function (message) { __bailout(message); }
};`;

const NODE_HOST = `var __SSR_HOST = {
  isAbstract: function () { return false; },
  types: function (v) { return v === null ? "null" : typeof v; },
  condParts: function () { return undefined; },
  str: function (f, a, b, c) { return f(a, b, c); },
  bool: function (f, a, b) { return f(a, b); },
  num: function (f, a, b, c) { return f(a, b, c); },
  widen: function (a) { return a; },
  bail: function (message) { throw new Error("react-ssr bailout: " + message); }
};`;

function assemble(appCode, host, rootProp, tail) {
  const model = loadModelSources();
  return `(function () {
${host}
${model.helpers}
${model.runtime}
var __SSR_APP = (function () {
  var module = { exports: {} };
  var exports = module.exports;
  function require(name) {
    if (name === "react") return __SSR.React;
    throw new Error("react-ssr: unsupported require(" + JSON.stringify(name) + ")");
  }
${appCode}
  return module.exports && module.exports.__esModule ? module.exports.default : module.exports;
})();
function __ssrRender(data) {
  return __SSR.renderToString(__SSR.React.createElement(__SSR_APP, { ${JSON.stringify(rootProp)}: data }));
}
${tail}
}).call(this);
`;
}

// The model evaluated by Node on concrete data (no Prepack), to check it against react-dom/server.
function interpret(appSource, options = {}) {
  const rootProp = options.rootProp || "data";
  const { code: appCode } = transformApp(appSource);
  const source = assemble(appCode, NODE_HOST, rootProp, "__result.render = __ssrRender;");
  const result = {};
  vm.runInNewContext(source, { __result: result, console }, { filename: "react-ssr-model.js" });
  return result.render;
}

function compile(appSource, options = {}) {
  const prepack = options.prepack || require(path.join(__dirname, "..", "lib", "prepack-node.js"));
  const rootProp = options.rootProp || "data";
  const schema = options.schema || (options.samples ? inferSchema(options.samples) : undefined);
  const { code: appCode, rewritten } = transformApp(appSource);
  const argModel =
    schema === undefined
      ? undefined
      : JSON.stringify({ universe: { Root: toShapeDescriptor(schema) }, arguments: { data: "Root" } });
  const tail = `this.__ssrRender = __ssrRender;
__optimize(__ssrRender${argModel === undefined ? "" : ", " + JSON.stringify(argModel)});`;
  const source = assemble(appCode, PREPACK_HOST, rootProp, tail);
  if (options.dumpInput) fs.writeFileSync(options.dumpInput, source);
  const diagnostics = [];
  const started = Date.now();
  let result;
  try {
    result = prepack.prepackSources([{ filePath: "react-ssr-input.js", fileContents: source }], {
      compatibility: "browser",
      arrayNestedOptimizedFunctionsEnabled: true,
      residualCallHeuristics: false,
      errorHandler: diagnostic => {
        diagnostics.push(diagnostic);
        return diagnostic.severity === "Warning" || diagnostic.severity === "Information" ? "Recover" : "Fail";
      },
      ...(options.prepackOptions || {}),
    });
  } catch (e) {
    const err = new Error(
      "react-ssr: specialization failed: " +
        (diagnostics.length
          ? diagnostics.map(d => `${d.errorCode} ${d.message} ${formatLocation(d.location)}`).join("\n")
          : e.message)
    );
    err.diagnostics = diagnostics;
    err.cause = e;
    throw err;
  }
  const code = result.code;
  const sandbox = Object.create(globalThis);
  // The output assigns the specialized function to the global object it is run with.
  new Function(code).call(sandbox);
  const render = sandbox.__ssrRender;
  if (typeof render !== "function") throw new Error("react-ssr: specialized output did not define __ssrRender");
  return {
    code,
    render,
    diagnostics,
    schema,
    stats: { compileMs: Date.now() - started, mappedChildren: rewritten, bytes: Buffer.byteLength(code) },
  };
}

function formatLocation(loc) {
  if (!loc || !loc.start) return "";
  return `(${loc.source || ""}:${loc.start.line}:${loc.start.column})`;
}

module.exports = { compile, interpret, inferSchema, toShapeDescriptor, transformApp };
