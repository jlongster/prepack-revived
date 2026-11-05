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
      if (!isCreateElementCall(node, p.scope)) return;
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

function isCreateElementCall(node, scope) {
  const callee = node.callee;
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property, { name: "createElement" })) {
    return true;
  }
  if (!t.isIdentifier(callee)) return false;
  if (callee.name === "createElement") return true;
  // An alias such as `var h = React.createElement` (never reassigned).
  const binding = scope.getBinding(callee.name);
  if (!binding || !binding.constant || !binding.path.isVariableDeclarator()) return false;
  const init = binding.path.node.init;
  return (
    t.isMemberExpression(init) && !init.computed && t.isIdentifier(init.property, { name: "createElement" })
  );
}

// ------------------------------------------------------------------------------------------------
// Output post-processing (pure syntactic rewrites that preserve JavaScript semantics):
//  - `var a = xs.map(f); ... a.join("")` (a used once) becomes a single string accumulating loop,
//    which avoids the intermediate array and the flattening of every item string by join;
//  - string concatenations are reassociated to the left and adjacent literals are merged.

function isKnownString(node) {
  return (
    t.isStringLiteral(node) ||
    t.isTemplateLiteral(node) ||
    (t.isBinaryExpression(node, { operator: "+" }) && (isKnownString(node.left) || isKnownString(node.right)))
  );
}

function optimizeOutput(code, helpers) {
  const ast = babelParser.parse(code, { sourceType: "script" });
  let mapJoins = 0;
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (
        !t.isIdentifier(p.node.id) ||
        !t.isCallExpression(init) ||
        init.arguments.length !== 1 ||
        !t.isMemberExpression(init.callee) ||
        init.callee.computed ||
        !t.isIdentifier(init.callee.property, { name: "map" }) ||
        !t.isIdentifier(init.arguments[0])
      ) {
        return;
      }
      const binding = p.scope.getBinding(p.node.id.name);
      if (!binding || !binding.constant || binding.referencePaths.length !== 1) return;
      const ref = binding.referencePaths[0];
      const member = ref.parentPath;
      const call = member && member.parentPath;
      if (
        !member.isMemberExpression() ||
        member.node.computed ||
        !t.isIdentifier(member.node.property, { name: "join" }) ||
        !call.isCallExpression() ||
        call.node.callee !== member.node ||
        call.node.arguments.length !== 1 ||
        !t.isStringLiteral(call.node.arguments[0], { value: "" })
      ) {
        return;
      }
      p.node.init = t.callExpression(t.identifier("__ssrMapJoin"), [init.callee.object, init.arguments[0]]);
      call.replaceWith(t.identifier(p.node.id.name));
      mapJoins++;
    },
  });
  traverse(ast, {
    BinaryExpression: {
      exit(p) {
        let node = p.node;
        if (node.operator !== "+") return;
        let changed = true;
        while (changed) {
          changed = false;
          const right = node.right;
          // A + (B + C) === (A + B) + C when B is a string, or A and C are strings.
          if (
            t.isBinaryExpression(right, { operator: "+" }) &&
            (isKnownString(right.left) || (isKnownString(node.left) && isKnownString(right.right)))
          ) {
            node = t.binaryExpression("+", t.binaryExpression("+", node.left, right.left), right.right);
            changed = true;
            continue;
          }
          // (X + "a") + "b" === X + "ab"; "a" + "b" === "ab"
          if (t.isStringLiteral(node.right)) {
            if (t.isStringLiteral(node.left)) {
              node = t.stringLiteral(node.left.value + node.right.value);
              break;
            }
            if (t.isBinaryExpression(node.left, { operator: "+" }) && t.isStringLiteral(node.left.right)) {
              node = t.binaryExpression(
                "+",
                node.left.left,
                t.stringLiteral(node.left.right.value + node.right.value)
              );
              changed = true;
            }
          }
          if (t.isBinaryExpression(node, { operator: "+" }) && t.isBinaryExpression(node.left, { operator: "+" })) {
            // Normalize the left operand too (it may have become reassociable).
            const left = node.left;
            if (
              t.isBinaryExpression(left.right, { operator: "+" }) &&
              (isKnownString(left.right.left) || (isKnownString(left.left) && isKnownString(left.right.right)))
            ) {
              node = t.binaryExpression(
                "+",
                t.binaryExpression("+", t.binaryExpression("+", left.left, left.right.left), left.right.right),
                node.right
              );
              changed = true;
            }
          }
        }
        if (node !== p.node) p.replaceWith(node);
      },
    },
  });
  let output = generate(ast, { compact: false, jsescOption: { minimal: true } }).code;
  if (mapJoins > 0) output = helperSource(helpers, "__ssrMapJoin") + "\n" + output;
  return { code: output, mapJoins };
}

// The source of one self-contained helper function from helpers.js.
function helperSource(helpers, name) {
  const ast = babelParser.parse(helpers, { sourceType: "script" });
  const decl = ast.program.body.find(n => t.isFunctionDeclaration(n) && n.id.name === name);
  return generate(decl).code;
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

// The schema as a runtime check. The specialized code is only valid for data of the schema it was
// specialized for (it relies on the types of the values it reads), so the generated render function
// first checks the data and falls back (to React, or an error) otherwise. Plain data is assumed:
// objects and arrays without accessors or proxies, and arrays without holes.
function validatorSource(schema) {
  let counter = 0;
  const fresh = () => "v" + counter++;
  // Statements that return false unless the value of variable v has type `type`.
  function check(type, v, indent) {
    const fail = cond => `${indent}if (${cond}) return false;\n`;
    switch (type.kind) {
      case "undefined":
        return fail(`${v} !== undefined`);
      case "null":
        return fail(`${v} !== null`);
      case "string":
      case "number":
      case "boolean":
        return fail(`typeof ${v} !== ${JSON.stringify(type.kind)}`);
      case "array": {
        if (type.element === undefined) return fail(`!Array.isArray(${v}) || ${v}.length !== 0`);
        const i = fresh();
        const e = fresh();
        return (
          fail(`!Array.isArray(${v})`) +
          `${indent}for (var ${i} = 0; ${i} < ${v}.length; ${i}++) {\n` +
          fail(`!(${i} in ${v})`).replace(indent, indent + "  ") +
          `${indent}  var ${e} = ${v}[${i}];\n` +
          check(type.element, e, indent + "  ") +
          `${indent}}\n`
        );
      }
      case "object": {
        let out = fail(`typeof ${v} !== "object" || ${v} === null || Array.isArray(${v})`);
        for (const k of Object.keys(type.properties)) {
          const p = fresh();
          out += `${indent}var ${p} = ${v}[${JSON.stringify(k)}];\n` + check(type.properties[k], p, indent);
        }
        return out;
      }
      case "union": {
        // One function per variant; the value conforms if one of them accepts it.
        // Scalar variants are tested inline.
        const tests = type.variants.map(variant => {
          switch (variant.kind) {
            case "undefined":
              return `${v} === undefined`;
            case "null":
              return `${v} === null`;
            case "string":
            case "number":
            case "boolean":
              return `typeof ${v} === ${JSON.stringify(variant.kind)}`;
            default: {
              const x = fresh();
              return `(function (${x}) {\n${check(variant, x, indent + "  ")}${indent}  return true;\n${indent}})(${v})`;
            }
          }
        });
        return fail(`!(${tests.join(" || ")})`);
      }
      default:
        throw new Error("react-ssr: unknown schema kind " + type.kind);
    }
  }
  return `this.__ssrConforms = function (data) {\n${check(schema, "data", "  ")}  return true;\n};`;
}

// ------------------------------------------------------------------------------------------------
// Prepack input assembly

const PREPACK_HOST = `var __SSR_HOST = {
  isAbstract: function (v) { return __isAbstract(v); },
  types: function (v) { return __possibleTypes(v); },
  condParts: function (v) { return __conditionalParts(v); },
  concatParts: function (v) { return __concatParts(v); },
  str1: function (f, a) { return __residual_pure("string", f, a); },
  str2: function (f, a, b) { return __residual_pure("string", f, a, b); },
  str3: function (f, a, b, c) { return __residual_pure("string", f, a, b, c); },
  bool2: function (f, a, b) { return __residual_pure("boolean", f, a, b); },
  strT2: function (f, a, b) { return __residual_unsafe("string", f, a, b); },
  boolT2: function (f, a, b) { return __residual_unsafe("boolean", f, a, b); },
  num3: function (f, a, b, c) { return __residual_pure("number", f, a, b, c); },
  widen: function (a) { return __widenArray(a); },
  bail: function (message) { __bailout(message); }
};`;

const NODE_HOST = `var __SSR_HOST = {
  isAbstract: function () { return false; },
  types: function (v) { return v === null ? "null" : typeof v; },
  condParts: function () { return undefined; },
  concatParts: function () { return undefined; },
  str1: function (f, a) { return f(a); },
  str2: function (f, a, b) { return f(a, b); },
  str3: function (f, a, b, c) { return f(a, b, c); },
  bool2: function (f, a, b) { return f(a, b); },
  strT2: function (f, a, b) { return f(a, b); },
  boolT2: function (f, a, b) { return f(a, b); },
  num3: function (f, a, b, c) { return f(a, b, c); },
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
      residualCallHeuristics: "loops",
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
  const optimized = options.optimizeOutput === false ? { code: result.code, mapJoins: 0 } : optimizeOutput(result.code, loadModelSources().helpers);
  const code = optimized.code;
  const fullCode = schema === undefined ? code : code + "\n" + validatorSource(schema) + "\n";
  const sandbox = Object.create(globalThis);
  // The output assigns the specialized function to the global object it is run with.
  new Function(fullCode).call(sandbox);
  const render = guardedRender(sandbox, options.fallback);
  return {
    code: fullCode,
    render,
    diagnostics,
    schema,
    stats: {
      compileMs: Date.now() - started,
      mappedChildren: rewritten,
      mapJoins: optimized.mapJoins,
      bytes: Buffer.byteLength(fullCode),
    },
  };
}

// The render function of a generated program run in sandbox: the specialized renderer for data of
// the schema, fallback(data) otherwise (an error if there is no fallback).
function guardedRender(sandbox, fallback) {
  const specialized = sandbox.__ssrRender;
  const conforms = sandbox.__ssrConforms;
  if (typeof specialized !== "function") throw new Error("react-ssr: specialized output did not define __ssrRender");
  if (typeof conforms !== "function") return specialized;
  const render = data => {
    if (conforms(data)) return specialized(data);
    render.fallbacks++;
    if (fallback) return fallback(data);
    throw new Error("react-ssr: data does not conform to the schema the renderer was specialized for");
  };
  render.fallbacks = 0;
  return render;
}

function instantiate(code, fallback) {
  const sandbox = Object.create(globalThis);
  new Function(code).call(sandbox);
  return guardedRender(sandbox, fallback);
}

function formatLocation(loc) {
  if (!loc || !loc.start) return "";
  return `(${loc.source || ""}:${loc.start.line}:${loc.start.column})`;
}

module.exports = { compile, instantiate, interpret, inferSchema, toShapeDescriptor, transformApp, validatorSource };
