/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @noflow (plain Node generator script; not @flow-typed) */

/*
 * Generates src/intrinsics/env/generatedModels.js from TypeScript's lib.dom.d.ts,
 * lib.es*.intl.d.ts, and @types/node/*.d.ts.
 *
 * Usage:
 *   node scripts/generate-env-models.js [--node-modules /tmp/opencode/env-dts-tools/node_modules]
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_NM = "/tmp/opencode/env-dts-tools/node_modules";

function parseArgs(argv) {
  let nodeModules = DEFAULT_NM;
  let outFile = path.join(ROOT, "src", "intrinsics", "env", "generatedModels.js");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--node-modules") nodeModules = path.resolve(argv[++i]);
    else if (argv[i] === "--out") outFile = path.resolve(argv[++i]);
  }
  return { nodeModules, outFile };
}

const TARGET_DOM_INTERFACES = [
  "Window",
  "Document",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "DocumentFragment",
  "CharacterData",
  "Text",
  "Comment",
  "CSSStyleDeclaration",
  "DOMTokenList",
  "DOMStringMap",
  "NamedNodeMap",
  "Attr",
  "NodeList",
  "HTMLCollection",
  "Navigator",
  "Location",
  "History",
  "Storage",
  "Screen",
  "Performance",
  "PerformanceTiming",
  "Event",
  "UIEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "InputEvent",
  "CustomEvent",
  "EventTarget",
  "MessageChannel",
  "MessagePort",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "URL",
  "URLSearchParams",
  "Headers",
  "Request",
  "Response",
  "AbortController",
  "AbortSignal",
  "Blob",
  "File",
  "FileReader",
  "FormData",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "Crypto",
  "TextEncoder",
  "TextDecoder",
  "MediaQueryList",
  "Selection",
  "Range",
];

const TARGET_DOM_GLOBALS = [
  "window",
  "self",
  "top",
  "parent",
  "frames",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "screen",
  "performance",
  "crypto",
  "customElements",
  "visualViewport",
  "devicePixelRatio",
  "innerWidth",
  "innerHeight",
  "outerWidth",
  "outerHeight",
  "scrollX",
  "scrollY",
  "pageXOffset",
  "pageYOffset",
  "origin",
  "isSecureContext",
  "name",
  "closed",
  "fetch",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "queueMicrotask",
  "atob",
  "btoa",
  "structuredClone",
  "getComputedStyle",
  "matchMedia",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "postMessage",
  "alert",
  "confirm",
  "prompt",
  "open",
  "close",
  "focus",
  "blur",
  "scroll",
  "scrollTo",
  "scrollBy",
  "HTMLElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "Text",
  "Comment",
  "Event",
  "CustomEvent",
  "UIEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "InputEvent",
  "AnimationEvent",
  "TransitionEvent",
  "CompositionEvent",
  "TouchEvent",
  "PointerEvent",
  "WheelEvent",
  "ClipboardEvent",
  "MessageChannel",
  "MessagePort",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "PerformanceObserver",
  "URL",
  "URLSearchParams",
  "Headers",
  "Request",
  "Response",
  "AbortController",
  "AbortSignal",
  "Blob",
  "File",
  "FileReader",
  "FormData",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "TextEncoder",
  "TextDecoder",
  "Image",
  "Audio",
  "Option",
  "DOMParser",
  "XMLSerializer",
  "CSS",
];

// Host functions that schedule callbacks asynchronously after synchronous global initialization.
const ASYNC_SCHEDULER_GLOBALS = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "queueMicrotask",
]);

const CORE_NODE_MODULES = ["path", "os", "url", "util"];

function main() {
  const { nodeModules, outFile } = parseArgs(process.argv.slice(2));
  const ts = require(path.join(nodeModules, "typescript"));
  const tsLibDir = path.join(nodeModules, "typescript", "lib");
  const nodeTypesDir = path.join(nodeModules, "@types", "node");

  function parseDts(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    return ts.createSourceFile(path.basename(filePath), text, ts.ScriptTarget.Latest, true);
  }

  const rawInterfaces = new Map();
  const typeAliases = new Map();
  const rawVars = new Map();
  const rawFuncs = new Map();
  const rawModuleExports = new Map(); // modName -> { vars: Map, funcs: Map }

  function ensureInterface(name) {
    let entry = rawInterfaces.get(name);
    if (!entry) {
      entry = { bases: new Set(), members: [] };
      rawInterfaces.set(name, entry);
    }
    return entry;
  }

  function ensureModule(modName) {
    let entry = rawModuleExports.get(modName);
    if (!entry) {
      entry = { vars: new Map(), funcs: new Map() };
      rawModuleExports.set(modName, entry);
    }
    return entry;
  }

  function collectFromStatements(statements, namespacePrefix, activeModule) {
    for (const stmt of statements) {
      if (ts.isInterfaceDeclaration(stmt)) {
        const name = namespacePrefix ? `${namespacePrefix}.${stmt.name.text}` : stmt.name.text;
        const entry = ensureInterface(name);
        if (stmt.heritageClauses) {
          for (const hc of stmt.heritageClauses) {
            for (const expr of hc.types) {
              const baseText = expr.expression.getText();
              const qualified =
                namespacePrefix && !baseText.includes(".") && rawInterfaces.has(`${namespacePrefix}.${baseText}`)
                  ? `${namespacePrefix}.${baseText}`
                  : baseText;
              entry.bases.add(qualified);
            }
          }
        }
        for (const m of stmt.members) entry.members.push(m);
      } else if (ts.isTypeAliasDeclaration(stmt)) {
        const name = namespacePrefix ? `${namespacePrefix}.${stmt.name.text}` : stmt.name.text;
        typeAliases.set(name, stmt.type);
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.type) {
            if (activeModule) {
              const modEntry = ensureModule(activeModule);
              if (!modEntry.vars.has(decl.name.text)) modEntry.vars.set(decl.name.text, decl.type);
            } else {
              const name = namespacePrefix ? `${namespacePrefix}.${decl.name.text}` : decl.name.text;
              if (!rawVars.has(name)) rawVars.set(name, decl.type);
            }
          }
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        if (activeModule) {
          const modEntry = ensureModule(activeModule);
          if (!modEntry.funcs.has(stmt.name.text)) modEntry.funcs.set(stmt.name.text, stmt.type);
        } else {
          const name = namespacePrefix ? `${namespacePrefix}.${stmt.name.text}` : stmt.name.text;
          if (!rawFuncs.has(name)) rawFuncs.set(name, stmt.type);
        }
      } else if (ts.isModuleDeclaration(stmt) && stmt.body) {
        const modName = stmt.name.text;
        const innerBody = unwrapModuleBody(stmt.body);
        if (!innerBody) continue;
        if (modName === "global") {
          collectFromStatements(innerBody.statements, "", undefined);
        } else if (modName.startsWith("node:") || CORE_NODE_MODULES.includes(modName)) {
          const cleanMod = modName.replace(/^node:/, "");
          collectFromStatements(innerBody.statements, cleanMod, cleanMod);
        } else {
          if (activeModule && modName === "constants") continue;
          const nextPrefix = namespacePrefix ? `${namespacePrefix}.${modName}` : modName;
          collectFromStatements(innerBody.statements, nextPrefix, activeModule);
        }
      }
    }
  }

  function unwrapModuleBody(body) {
    let cur = body;
    while (cur && ts.isModuleDeclaration(cur) && cur.body) cur = cur.body;
    return cur && ts.isModuleBlock(cur) ? cur : undefined;
  }

  // 1. Parse DOM + ES5 + ES Intl .d.ts files
  collectFromStatements(parseDts(path.join(tsLibDir, "lib.dom.d.ts")).statements, "", undefined);
  collectFromStatements(parseDts(path.join(tsLibDir, "lib.es5.d.ts")).statements, "", undefined);
  for (const f of fs.readdirSync(tsLibDir).sort()) {
    if (f.includes(".intl.") && f.endsWith(".d.ts")) {
      collectFromStatements(parseDts(path.join(tsLibDir, f)).statements, "", undefined);
    }
  }

  // 2. Parse @types/node core .d.ts files
  const nodeFiles = [
    "globals.d.ts",
    "process.d.ts",
    "module.d.ts",
    "buffer.d.ts",
    "timers.d.ts",
    "path.d.ts",
    "os.d.ts",
    "url.d.ts",
    "events.d.ts",
    "util.d.ts",
  ];
  for (const nf of nodeFiles) {
    const full = path.join(nodeTypesDir, nf);
    if (fs.existsSync(full)) {
      collectFromStatements(parseDts(full).statements, "", undefined);
    }
  }

  const targetInterfaceSet = new Set([
    ...TARGET_DOM_INTERFACES,
    "Intl.Collator",
    "Intl.NumberFormat",
    "Intl.DateTimeFormat",
    "Intl.PluralRules",
    "Intl.RelativeTimeFormat",
    "Intl.ListFormat",
    "Intl.DisplayNames",
    "Intl.Segmenter",
    "Intl.Locale",
    "NodeJS.Process",
    "NodeJS.ProcessEnv",
    "NodeJS.WriteStream",
    "NodeJS.ReadStream",
    "NodeModule",
    "NodeRequire",
  ]);

  function normalizeInterfaceRef(refName) {
    if (targetInterfaceSet.has(refName)) return refName;
    if (/^HTML.*Element$/.test(refName)) return "HTMLElement";
    if (/^SVG.*Element$/.test(refName)) return "SVGElement";
    if (/^DOMMatrix|^DOMRect|^DOMPoint/.test(refName)) return "object";
    if (refName === "ParentNode" || refName === "ChildNode" || refName === "Element") return "Element";
    if (refName === "NodeListOf") return "NodeList";
    if (refName === "HTMLCollectionOf" || refName === "HTMLCollectionBase") return "HTMLCollection";
    if (refName === "WindowProxy") return "Window";
    if (refName === "NodeJS.Module") return "NodeModule";
    if (refName === "NodeJS.Require") return "NodeRequire";
    return undefined;
  }

  function classifyTypeNode(typeNode, typeParams, depth = 0) {
    if (!typeNode || depth > 6) return { type: "top" };
    const k = typeNode.kind;
    if (k === ts.SyntaxKind.StringKeyword || k === ts.SyntaxKind.TemplateLiteralType) return { type: "string" };
    if (k === ts.SyntaxKind.NumberKeyword) return { type: "number" };
    if (k === ts.SyntaxKind.BooleanKeyword) return { type: "boolean" };
    if (k === ts.SyntaxKind.VoidKeyword || k === ts.SyntaxKind.UndefinedKeyword) return { type: "undefined" };
    if (k === ts.SyntaxKind.NullKeyword) return { type: "null" };
    if (k === ts.SyntaxKind.SymbolKeyword) return { type: "symbol" };
    if (k === ts.SyntaxKind.ObjectKeyword) return { type: "object" };
    if (k === ts.SyntaxKind.AnyKeyword || k === ts.SyntaxKind.UnknownKeyword) return { type: "top" };
    if (ts.isThisTypeNode(typeNode)) return { type: "object" };
    if (ts.isLiteralTypeNode(typeNode)) {
      const lit = typeNode.literal;
      if (ts.isStringLiteral(lit)) return { type: "string" };
      if (ts.isNumericLiteral(lit)) return { type: "number" };
      if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword)
        return { type: "boolean" };
      if (lit.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
    }
    if (ts.isParenthesizedTypeNode(typeNode)) return classifyTypeNode(typeNode.type, typeParams, depth + 1);
    if (ts.isArrayTypeNode(typeNode) || ts.isTupleTypeNode(typeNode)) return { type: "object" };
    if (ts.isFunctionTypeNode(typeNode)) {
      const ret = classifyTypeNode(typeNode.type, typeParams, depth + 1);
      return { type: "function", returnType: ret.type, returnNullable: !!ret.nullable };
    }
    if (ts.isTypeLiteralNode(typeNode)) return { type: "object" };
    if (ts.isUnionTypeNode(typeNode)) {
      let nullable = false;
      let optional = false;
      const nonNull = [];
      for (const part of typeNode.types) {
        const c = classifyTypeNode(part, typeParams, depth + 1);
        if (c.type === "null") nullable = true;
        else if (c.type === "undefined") optional = true;
        else {
          if (c.nullable) nullable = true;
          if (c.optional) optional = true;
          nonNull.push(c);
        }
      }
      if (nonNull.length === 0) {
        return nullable && !optional ? { type: "null" } : { type: "undefined" };
      }
      const first = nonNull[0];
      const sameType = nonNull.every(x => x.type === first.type && x.shape === first.shape);
      if (sameType) {
        const out = Object.assign({}, first);
        if (nullable) out.nullable = true;
        if (optional) out.optional = true;
        return out;
      }
      if (nonNull.every(x => x.type === "object")) {
        const out = { type: "object" };
        if (nullable) out.nullable = true;
        if (optional) out.optional = true;
        return out;
      }
      return { type: "top" };
    }
    if (ts.isTypeReferenceNode(typeNode)) {
      const refName = typeNode.typeName.getText();
      if (typeParams && typeParams.has(refName)) {
        return classifyTypeNode(typeParams.get(refName), undefined, depth + 1);
      }
      if (refName === "Array" || refName === "ReadonlyArray" || refName === "Promise") return { type: "object" };
      if (refName === "Function") return { type: "function", returnType: "top" };
      if (refName === "Record" || refName === "Dict" || refName === "NodeJS.Dict") {
        if (typeNode.typeArguments && typeNode.typeArguments.length >= 2) {
          const valInfo = classifyTypeNode(typeNode.typeArguments[1], typeParams, depth + 1);
          return { type: "object", dictType: valInfo.type, dictOptional: true };
        }
        return { type: "object" };
      }
      const mapped = normalizeInterfaceRef(refName);
      if (mapped === "object") return { type: "object" };
      if (mapped) return { type: "object", shape: mapped };
      if (typeAliases.has(refName)) return classifyTypeNode(typeAliases.get(refName), typeParams, depth + 1);
      if (rawInterfaces.has(refName)) return { type: "object" };
    }
    return { type: "top" };
  }

  function getPropertyNameText(nameNode) {
    if (!nameNode) return undefined;
    if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) return nameNode.text;
    return undefined;
  }

  function shouldSkipDomProp(ifaceName, propName) {
    // Skip the ~120 GlobalEventHandlers on* nullable callback props; index/open-world handles them cleanly.
    if (/^on[a-z]+$/.test(propName)) return true;
    // Skip the ~500 individual CSS style camelCase props on CSSStyleDeclaration; index: { t: "string" } covers all.
    if (ifaceName === "CSSStyleDeclaration" && propName !== "cssText" && propName !== "length") return true;
    if (/^[A-Z0-9_]+$/.test(propName) && propName !== "URL" && propName !== "JSON" && propName !== "EOL") return true;
    return false;
  }

  function extractTypeParams(member) {
    if (!member.typeParameters || member.typeParameters.length === 0) return undefined;
    const map = new Map();
    for (const tp of member.typeParameters) {
      if (tp.constraint) map.set(tp.name.text, tp.constraint);
    }
    return map;
  }

  function buildInterfaceShape(name) {
    const visited = new Set();
    const props = {};
    const methods = {};
    let indexValue = undefined;
    let callReturn = undefined;

    function visit(ifaceName) {
      if (visited.has(ifaceName)) return;
      visited.add(ifaceName);
      let raw = rawInterfaces.get(ifaceName);
      if (!raw && ifaceName.includes(".")) {
        const shortName = ifaceName.split(".").pop();
        raw = rawInterfaces.get(shortName);
      }
      if (!raw) return;
      for (const base of raw.bases) {
        visit(base);
        const stripped = base.replace(/<.*>$/, "");
        if (stripped !== base) visit(stripped);
      }
      for (const m of raw.members) {
        if (ts.isPropertySignature(m) || ts.isGetAccessorDeclaration(m)) {
          const propName = getPropertyNameText(m.name);
          if (!propName || shouldSkipDomProp(name, propName)) continue;
          const info = classifyTypeNode(m.type, undefined);
          if (m.questionToken) info.optional = true;
          if (info.type === "function") {
            methods[propName] = compactMethod(info.returnType || "top", undefined, !!info.returnNullable);
          } else {
            props[propName] = compactProp(info);
          }
        } else if (ts.isMethodSignature(m)) {
          const propName = getPropertyNameText(m.name);
          if (!propName || shouldSkipDomProp(name, propName)) continue;
          const tps = extractTypeParams(m);
          const ret = classifyTypeNode(m.type, tps);
          methods[propName] = compactMethod(ret.type, ret.shape, !!ret.nullable, !!ret.optional);
        } else if (ts.isIndexSignatureDeclaration(m) && m.type) {
          const idxInfo = classifyTypeNode(m.type, undefined);
          indexValue = compactProp(idxInfo);
        } else if (ts.isCallSignatureDeclaration(m)) {
          const tps = extractTypeParams(m);
          const ret = classifyTypeNode(m.type, tps);
          callReturn = compactMethod(ret.type, ret.shape, !!ret.nullable, !!ret.optional);
        }
      }
    }

    visit(name);
    const out = {};
    if (Object.keys(props).length > 0) out.props = props;
    if (Object.keys(methods).length > 0) out.methods = methods;
    if (indexValue !== undefined) out.index = indexValue;
    if (callReturn !== undefined) out.call = callReturn;
    return out;
  }

  function compactProp(info) {
    const res = { t: info.type };
    if (info.shape) res.s = info.shape;
    if (info.nullable) res.n = true;
    if (info.optional) res.o = true;
    return res;
  }

  function compactMethod(retType, shape, nullable, optional) {
    const res = { r: retType || "top" };
    if (shape) res.s = shape;
    if (nullable) res.n = true;
    if (optional) res.o = true;
    return res;
  }

  const shapes = {};
  for (const iface of targetInterfaceSet) {
    const s = buildInterfaceShape(iface);
    if (Object.keys(s).length > 0) {
      shapes[iface] = s;
    }
  }

  // CSSStyleDeclaration: style properties accessed by name are strings
  shapes.CSSStyleDeclaration = Object.assign({}, shapes.CSSStyleDeclaration || {}, {
    index: { t: "string" },
  });

  // NodeJS.ProcessEnv: process.env[K] is string | undefined
  shapes["NodeJS.ProcessEnv"] = {
    index: { t: "string", o: true },
  };
  if (shapes["NodeJS.Process"] && shapes["NodeJS.Process"].props) {
    shapes["NodeJS.Process"].props.env = { t: "object", s: "NodeJS.ProcessEnv" };
  }

  // Core Node modules from @types/node module declarations (path, os, url, util)
  const nodeBuiltinModules = {};
  for (const modName of CORE_NODE_MODULES) {
    const modEntry = rawModuleExports.get(modName);
    if (!modEntry) continue;
    const modProps = {};
    const modMethods = {};
    for (const [k, vType] of modEntry.vars) {
      const c = classifyTypeNode(vType, undefined);
      modProps[k] = compactProp(c);
    }
    for (const [k, fType] of modEntry.funcs) {
      const ret = classifyTypeNode(fType, undefined);
      modMethods[k] = compactMethod(ret.type, ret.shape, !!ret.nullable, !!ret.optional);
    }
    // In @types/node/path.d.ts, path exports an instance of PlatformPath; merge PlatformPath if present
    if (modName === "path" && rawInterfaces.has("path.PlatformPath")) {
      const pp = buildInterfaceShape("path.PlatformPath");
      Object.assign(modProps, pp.props || {});
      Object.assign(modMethods, pp.methods || {});
    }
    if (Object.keys(modProps).length > 0 || Object.keys(modMethods).length > 0) {
      const shapeKey = `node:${modName}`;
      shapes[shapeKey] = {};
      if (Object.keys(modProps).length > 0) shapes[shapeKey].props = modProps;
      if (Object.keys(modMethods).length > 0) shapes[shapeKey].methods = modMethods;
      nodeBuiltinModules[modName] = shapeKey;
      nodeBuiltinModules[`node:${modName}`] = shapeKey;
    }
  }

  // Intl namespace shape
  const intlConstructors = [
    "Collator",
    "NumberFormat",
    "DateTimeFormat",
    "PluralRules",
    "RelativeTimeFormat",
    "ListFormat",
    "DisplayNames",
    "Segmenter",
    "Locale",
  ];
  const intlProps = {};
  for (const c of intlConstructors) {
    const full = `Intl.${c}`;
    if (shapes[full]) {
      intlProps[c] = { t: "constructor", s: full };
    }
  }
  shapes.Intl = {
    props: intlProps,
    methods: {
      getCanonicalLocales: { r: "object" },
      supportedValuesOf: { r: "object" },
    },
  };

  // DOM globals table
  const domGlobals = {};
  for (const g of TARGET_DOM_GLOBALS) {
    if (ASYNC_SCHEDULER_GLOBALS.has(g)) {
      const fnRet = rawFuncs.has(g) ? classifyTypeNode(rawFuncs.get(g), undefined) : { type: "undefined" };
      domGlobals[g] = { k: "asyncFn", r: fnRet.type };
      continue;
    }
    if (rawVars.has(g)) {
      const vType = rawVars.get(g);
      if (ts.isTypeLiteralNode(vType)) {
        const hasConstruct = vType.members.some(m => ts.isConstructSignatureDeclaration(m));
        if (hasConstruct) {
          const instanceShape = targetInterfaceSet.has(g) ? g : undefined;
          domGlobals[g] = instanceShape ? { k: "ctor", s: instanceShape } : { k: "ctor" };
          continue;
        }
      }
      const c = classifyTypeNode(vType, undefined);
      domGlobals[g] = Object.assign({ k: "var" }, compactProp(c));
    } else if (rawFuncs.has(g)) {
      const ret = classifyTypeNode(rawFuncs.get(g), undefined);
      domGlobals[g] = Object.assign({ k: "fn" }, compactMethod(ret.type, ret.shape, !!ret.nullable, !!ret.optional));
    } else if (targetInterfaceSet.has(g) || /Event$/.test(g)) {
      domGlobals[g] = targetInterfaceSet.has(g) ? { k: "ctor", s: g } : { k: "ctor" };
    }
  }
  for (const w of ["window", "self", "top", "parent", "frames"]) {
    domGlobals[w] = { k: "var", t: "object", s: "Window" };
  }

  const nodeGlobals = {
    process: { k: "var", t: "object", s: "NodeJS.Process" },
    module: { k: "var", t: "object", s: "NodeModule" },
    exports: { k: "var", t: "object" },
    require: { k: "fn", r: "top", s: "NodeRequire" },
    __dirname: { k: "var", t: "string" },
    __filename: { k: "var", t: "string" },
    Buffer: { k: "ctor", s: "Buffer" },
    setImmediate: { k: "asyncFn", r: "object" },
    clearImmediate: { k: "asyncFn", r: "undefined" },
    queueMicrotask: { k: "asyncFn", r: "undefined" },
  };

  const umdGlobals = {
    Intl: { k: "var", t: "object", s: "Intl" },
    define: { k: "fn", r: "top" },
    globalThis: { k: "var", t: "object", s: "Window" },
  };

  const header = `/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

/*
 * AUTO-GENERATED by scripts/generate-env-models.js from TypeScript lib.dom.d.ts,
 * lib.es*.intl.d.ts, and @types/node/*.d.ts. Do not edit by hand; re-run:
 *   node scripts/generate-env-models.js
 */

export type ModelScalarType =
  | "top"
  | "string"
  | "number"
  | "boolean"
  | "undefined"
  | "null"
  | "symbol"
  | "object"
  | "function"
  | "constructor";

export type ModelPropSpec = {|
  +t: ModelScalarType,
  +s?: string,
  +n?: boolean,
  +o?: boolean,
|};

export type ModelMethodSpec = {|
  +r: ModelScalarType,
  +s?: string,
  +n?: boolean,
  +o?: boolean,
|};

export type ModelShapeSpec = {|
  +props?: { +[string]: ModelPropSpec },
  +methods?: { +[string]: ModelMethodSpec },
  +index?: ModelPropSpec,
  +call?: ModelMethodSpec,
|};

export type ModelGlobalSpec =
  | {| +k: "var", +t: ModelScalarType, +s?: string, +n?: boolean, +o?: boolean |}
  | {| +k: "fn", +r: ModelScalarType, +s?: string, +n?: boolean, +o?: boolean |}
  | {| +k: "asyncFn", +r: ModelScalarType |}
  | {| +k: "ctor", +s?: string |};

`;

  const body =
    `export const GeneratedShapes: { +[string]: ModelShapeSpec } = ${JSON.stringify(shapes, null, 2)};\n\n` +
    `export const GeneratedDOMGlobals: { +[string]: ModelGlobalSpec } = ${JSON.stringify(domGlobals, null, 2)};\n\n` +
    `export const GeneratedNodeGlobals: { +[string]: ModelGlobalSpec } = ${JSON.stringify(nodeGlobals, null, 2)};\n\n` +
    `export const GeneratedUMDGlobals: { +[string]: ModelGlobalSpec } = ${JSON.stringify(umdGlobals, null, 2)};\n\n` +
    `export const GeneratedNodeModules: { +[string]: string } = ${JSON.stringify(nodeBuiltinModules, null, 2)};\n`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, header + body);
  console.log(
    `Wrote ${path.relative(ROOT, outFile)} (${Object.keys(shapes).length} shapes, ` +
      `${Object.keys(domGlobals).length} DOM globals, ${Object.keys(nodeGlobals).length} Node globals)`
  );
}

main();
