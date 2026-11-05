/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { Realm } from "../../realm.js";
import type { SourceFile } from "../../types.js";
import { BooleanValue, NumberValue, StringValue, Value } from "../../values/index.js";
import * as t from "@babel/types";
import type {
  BabelNodeExpression,
  BabelNodeFile,
  BabelNodeIdentifier,
  BabelNodeMemberExpression,
  BabelNodeStatement,
  BabelNodeUnaryExpression,
} from "@babel/types";
import { parse as babelParse } from "@babel/parser";
import traverseFast from "../../utils/traverse-fast.js";
import invariant from "../../invariant.js";

export const UNDEFINED_SENTINEL = "__prepack_undefined__";

export function parseCliAssumption(spec: string): [string, mixed] {
  let eq = spec.indexOf("=");
  if (eq <= 0) {
    throw new Error(`Invalid --assume specification "${spec}"; expected KEY=JSON (e.g. typeof window="undefined")`);
  }
  let key = spec.slice(0, eq).trim();
  let rawVal = spec.slice(eq + 1).trim();
  if (rawVal === "undefined") {
    return [key, UNDEFINED_SENTINEL];
  }
  return [key, JSON.parse(rawVal)];
}

function isUndefinedAssumption(raw: mixed): boolean {
  return raw === undefined || raw === UNDEFINED_SENTINEL;
}

function recordGuard(realm: Realm, key: string, expr: BabelNodeExpression): void {
  if (realm.isReadOnly) return;
  if (!realm.usedAssumptionGuards.has(key)) {
    realm.usedAssumptionGuards.set(key, expr);
  }
}

function literalGuardEquality(lhs: BabelNodeExpression, raw: mixed): BabelNodeExpression {
  if (isUndefinedAssumption(raw)) {
    return t.binaryExpression("===", lhs, t.unaryExpression("void", t.numericLiteral(0)));
  }
  if (raw === null) {
    return t.binaryExpression("===", lhs, t.nullLiteral());
  }
  if (typeof raw === "boolean") {
    return t.binaryExpression("===", lhs, t.booleanLiteral(raw));
  }
  if (typeof raw === "string") {
    return t.binaryExpression("===", lhs, t.stringLiteral(raw));
  }
  if (typeof raw === "number") {
    if (Number.isNaN(raw)) {
      return t.binaryExpression("!==", lhs, lhs);
    }
    if (Object.is(raw, -0)) {
      return t.logicalExpression(
        "&&",
        t.binaryExpression("===", lhs, t.numericLiteral(0)),
        t.binaryExpression(
          "===",
          t.binaryExpression("/", t.numericLiteral(1), lhs),
          t.unaryExpression("-", t.identifier("Infinity"))
        )
      );
    }
    const numNode = raw < 0 ? t.unaryExpression("-", t.numericLiteral(-raw)) : t.numericLiteral(raw);
    return t.binaryExpression("===", lhs, numNode);
  }
  invariant(false, "unsupported assumption value");
}

function rawToRealmValue(realm: Realm, raw: mixed): void | Value {
  if (isUndefinedAssumption(raw)) return realm.intrinsics.undefined;
  if (raw === null) return realm.intrinsics.null;
  if (typeof raw === "boolean") return new BooleanValue(realm, raw);
  if (typeof raw === "number") return new NumberValue(realm, raw);
  if (typeof raw === "string") return new StringValue(realm, raw);
  return undefined;
}

function buildSafePathGuard(
  parts: Array<string>,
  leafCheck: BabelNodeExpression => BabelNodeExpression
): BabelNodeExpression {
  invariant(parts.length >= 1);
  let root = parts[0];
  let checks: Array<BabelNodeExpression> = [
    t.binaryExpression("!==", t.unaryExpression("typeof", t.identifier(root), true), t.stringLiteral("undefined")),
  ];
  let cur: BabelNodeExpression = t.identifier(root);
  for (let i = 1; i < parts.length; i++) {
    checks.push(t.binaryExpression("!=", cur, t.nullLiteral()));
    const seg = parts[i];
    cur = t.isValidIdentifier(seg)
      ? t.memberExpression(cur, t.identifier(seg), false)
      : t.memberExpression(cur, t.stringLiteral(seg), true);
  }
  checks.push(leafCheck(cur));
  return checks.reduce((a, b) => t.logicalExpression("&&", a, b));
}

export function lookupTypeofGlobalAssumption(realm: Realm, name: string): void | StringValue {
  let assumptions = realm.assumptions;
  if (!assumptions) return undefined;
  let typeofKey = `typeof ${name}`;
  if (Object.prototype.hasOwnProperty.call(assumptions, typeofKey)) {
    let expected = assumptions[typeofKey];
    if (typeof expected === "string") {
      recordGuard(
        realm,
        typeofKey,
        t.binaryExpression("===", t.unaryExpression("typeof", t.identifier(name), true), t.stringLiteral(expected))
      );
      return new StringValue(realm, expected);
    }
  }
  if (Object.prototype.hasOwnProperty.call(assumptions, name)) {
    let raw = assumptions[name];
    if (isUndefinedAssumption(raw)) {
      recordGuard(
        realm,
        `typeof:${name}:undef`,
        t.binaryExpression("===", t.unaryExpression("typeof", t.identifier(name), true), t.stringLiteral("undefined"))
      );
      return new StringValue(realm, "undefined");
    }
    let val = rawToRealmValue(realm, raw);
    if (val !== undefined) {
      let guard = buildSafePathGuard([name], expr => literalGuardEquality(expr, raw));
      recordGuard(realm, `val:${name}`, guard);
      let jsType = raw === null ? "object" : typeof raw;
      return new StringValue(realm, jsType);
    }
  }
  return undefined;
}

export function lookupTypeofPathAssumption(realm: Realm, envPath: string): void | StringValue {
  let assumptions = realm.assumptions;
  if (!assumptions) return undefined;
  let typeofKey = `typeof ${envPath}`;
  if (Object.prototype.hasOwnProperty.call(assumptions, typeofKey)) {
    let expected = assumptions[typeofKey];
    if (typeof expected === "string") {
      let parts = envPath.split(".");
      if (parts.length === 1) {
        return lookupTypeofGlobalAssumption(realm, parts[0]);
      }
      let guard = buildSafePathGuard(parts, expr =>
        t.binaryExpression("===", t.unaryExpression("typeof", expr, true), t.stringLiteral(expected))
      );
      recordGuard(realm, typeofKey, guard);
      return new StringValue(realm, expected);
    }
  }
  if (Object.prototype.hasOwnProperty.call(assumptions, envPath)) {
    let raw = assumptions[envPath];
    let parts = envPath.split(".");
    if (isUndefinedAssumption(raw) && parts.length === 1) {
      return lookupTypeofGlobalAssumption(realm, parts[0]);
    }
    let val = rawToRealmValue(realm, raw);
    if (val !== undefined) {
      let guard = buildSafePathGuard(parts, expr => literalGuardEquality(expr, raw));
      recordGuard(realm, `val:${envPath}`, guard);
      let jsType = isUndefinedAssumption(raw) ? "undefined" : raw === null ? "object" : typeof raw;
      return new StringValue(realm, jsType);
    }
  }
  return undefined;
}

export function lookupValueAssumption(realm: Realm, envPath: string): void | Value {
  let assumptions = realm.assumptions;
  if (!assumptions) return undefined;
  if (Object.prototype.hasOwnProperty.call(assumptions, envPath)) {
    let raw = assumptions[envPath];
    let val = rawToRealmValue(realm, raw);
    if (val !== undefined) {
      let parts = envPath.split(".");
      if (parts.length === 1 && isUndefinedAssumption(raw)) {
        recordGuard(
          realm,
          `val:${envPath}:undef`,
          t.logicalExpression(
            "||",
            t.binaryExpression(
              "===",
              t.unaryExpression("typeof", t.identifier(parts[0]), true),
              t.stringLiteral("undefined")
            ),
            literalGuardEquality(t.identifier(parts[0]), undefined)
          )
        );
      } else {
        let guard = buildSafePathGuard(parts, expr => literalGuardEquality(expr, raw));
        recordGuard(realm, `val:${envPath}`, guard);
      }
      return val;
    }
  }
  let parts = envPath.split(".");
  if (parts.length === 1) {
    let typeofKey = `typeof ${envPath}`;
    if (Object.prototype.hasOwnProperty.call(assumptions, typeofKey) && assumptions[typeofKey] === "undefined") {
      recordGuard(
        realm,
        typeofKey,
        t.binaryExpression(
          "===",
          t.unaryExpression("typeof", t.identifier(envPath), true),
          t.stringLiteral("undefined")
        )
      );
      return realm.intrinsics.undefined;
    }
  }
  return undefined;
}

export function lookupTimezoneOffsetAssumption(realm: Realm, sampleTimestamp?: number): void | number {
  let assumptions = realm.assumptions;
  if (!assumptions || !Object.prototype.hasOwnProperty.call(assumptions, "timezoneOffset")) return undefined;
  let offset = assumptions.timezoneOffset;
  if (typeof offset !== "number" || !isFinite(offset)) return undefined;

  const makeOffsetCheck = (ts: number): BabelNodeExpression => {
    const tsNode = ts < 0 ? t.unaryExpression("-", t.numericLiteral(-ts)) : t.numericLiteral(ts);
    const offNode = offset < 0 ? t.unaryExpression("-", t.numericLiteral(-offset)) : t.numericLiteral(offset);
    return t.binaryExpression(
      "===",
      t.callExpression(
        t.memberExpression(t.newExpression(t.identifier("Date"), [tsNode]), t.identifier("getTimezoneOffset")),
        []
      ),
      offNode
    );
  };

  // Guard both January and July to catch any hemisphere's DST rules.
  recordGuard(
    realm,
    "timezoneOffset:base",
    t.logicalExpression("&&", makeOffsetCheck(0), makeOffsetCheck(1593561600000))
  );
  if (sampleTimestamp !== undefined && isFinite(sampleTimestamp) && realm.usedAssumptionGuards.size < 16) {
    recordGuard(realm, `timezoneOffset:${sampleTimestamp}`, makeOffsetCheck(sampleTimestamp));
  }
  return offset;
}

export function wrapProgramWithAssumptionGuards(
  realm: Realm,
  serializedAst: BabelNodeFile,
  originalCode: string
): BabelNodeFile {
  if (realm.usedAssumptionGuards.size === 0) return serializedAst;

  let guardNodes: Array<BabelNodeExpression> = [];
  for (let node of realm.usedAssumptionGuards.values()) {
    guardNodes.push((node: any));
  }
  let combinedGuard = guardNodes.reduce((a, b) => t.logicalExpression("&&", a, b));

  if (realm.fallbackMode === "throw") {
    let throwGuard = t.ifStatement(
      t.unaryExpression("!", combinedGuard, true),
      t.blockStatement([
        t.throwStatement(t.newExpression(t.identifier("Error"), [t.stringLiteral("Prepack assumption violated")])),
      ])
    );
    serializedAst.program.body.unshift(throwGuard);
    return serializedAst;
  }

  // Inline fallback mode: emit `if (guard) { <specialized> } else { <original> }`
  let origAst = babelParse(originalCode, { sourceType: "script", allowReturnOutsideFunction: true });
  let origIsStrict =
    Array.isArray(origAst.program.directives) &&
    origAst.program.directives.some(d => d.value && d.value.value === "use strict");

  // Keep hoisted `var` / `let` declarations at Program top level so global bindings exist in scope.
  let hoistedDecls: Array<BabelNodeStatement> = [];
  let fastPathStmts: Array<BabelNodeStatement> = [];
  let hoistedLetNames = new Set();
  for (let stmt of serializedAst.program.body) {
    if (stmt.type === "VariableDeclaration" && stmt.declarations.every(d => d.init == null)) {
      if (stmt.kind === "let") {
        for (let d of stmt.declarations) {
          if (d.id.type === "Identifier") hoistedLetNames.add(d.id.name);
        }
      }
      hoistedDecls.push(stmt);
    } else {
      fastPathStmts.push(stmt);
    }
  }

  let slowPathStmts: Array<BabelNodeStatement>;
  if (origIsStrict) {
    // Preserve top-level "use strict" inside an IIFE bound to `this`, exporting any top-level var/function declarations.
    let topVarNames: Array<string> = [];
    for (let stmt of origAst.program.body) {
      if (stmt.type === "VariableDeclaration" && stmt.kind === "var") {
        for (let name of Object.keys(t.getOuterBindingIdentifiers(stmt))) topVarNames.push(name);
      } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
        topVarNames.push(stmt.id.name);
      }
    }
    let syncStmts = topVarNames.map(n =>
      t.expressionStatement(
        t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier(n)), t.identifier(n))
      )
    );
    let fn = t.functionExpression(
      null,
      [],
      t.blockStatement([...origAst.program.body, ...syncStmts], [t.directive(t.directiveLiteral("use strict"))])
    );
    slowPathStmts = [
      t.expressionStatement(t.callExpression(t.memberExpression(fn, t.identifier("call")), [t.thisExpression()])),
    ];
  } else {
    slowPathStmts = origAst.program.body.map(stmt => {
      if (
        hoistedLetNames.size > 0 &&
        stmt.type === "VariableDeclaration" &&
        (stmt.kind === "let" || stmt.kind === "const") &&
        stmt.declarations.every(d => d.id.type === "Identifier" && hoistedLetNames.has(d.id.name))
      ) {
        let exprs = stmt.declarations.map(d =>
          t.assignmentExpression(
            "=",
            t.identifier(((d.id: any): BabelNodeIdentifier).name),
            d.init || t.unaryExpression("void", t.numericLiteral(0))
          )
        );
        return t.expressionStatement(exprs.length === 1 ? exprs[0] : t.sequenceExpression(exprs));
      }
      return stmt;
    });
  }

  let guardedStmt = t.ifStatement(combinedGuard, t.blockStatement(fastPathStmts), t.blockStatement(slowPathStmts));
  return t.file(t.program([...hoistedDecls, guardedStmt], serializedAst.program.directives));
}

// Profiles the environment probes in `sources` against a Node or Browser target,
// returning an assumptions dictionary suitable for `options.assumptions`.
export function profileEnvironment(
  sources: Array<SourceFile>,
  target: "node" | "browser" = "node"
): { [string]: mixed } {
  let code = sources.map(s => s.fileContents).join("\n;\n");
  let ast = babelParse(code, { sourceType: "script", allowReturnOutsideFunction: true });
  let typeofIds = new Set();
  let processEnvKeys = new Set();
  let usesDate = false;

  traverseFast(ast, node => {
    if (node.type === "UnaryExpression") {
      let unary = ((node: any): BabelNodeUnaryExpression);
      if (unary.operator === "typeof" && unary.argument.type === "Identifier") {
        typeofIds.add(((unary.argument: any): BabelNodeIdentifier).name);
      }
    } else if (node.type === "MemberExpression") {
      let mem = ((node: any): BabelNodeMemberExpression);
      if (!mem.computed && mem.object.type === "MemberExpression" && mem.property.type === "Identifier") {
        let inner = ((mem.object: any): BabelNodeMemberExpression);
        if (
          !inner.computed &&
          inner.object.type === "Identifier" &&
          ((inner.object: any): BabelNodeIdentifier).name === "process" &&
          inner.property.type === "Identifier" &&
          ((inner.property: any): BabelNodeIdentifier).name === "env"
        ) {
          processEnvKeys.add(((mem.property: any): BabelNodeIdentifier).name);
        }
      }
    } else if (node.type === "Identifier" && ((node: any): BabelNodeIdentifier).name === "Date") {
      usesDate = true;
    }
    return false;
  });

  let probeNames = new Set([
    "window",
    "document",
    "self",
    "global",
    "process",
    "module",
    "exports",
    "require",
    "define",
    "Intl",
  ]);
  let assumptions: { [string]: mixed } = {};
  for (let name of typeofIds) {
    if (!probeNames.has(name)) continue;
    if (target === "node") {
      if (name === "window" || name === "document" || name === "self" || name === "define") {
        assumptions[`typeof ${name}`] = "undefined";
      } else if (
        name === "global" ||
        name === "process" ||
        name === "module" ||
        name === "exports" ||
        name === "Intl"
      ) {
        assumptions[`typeof ${name}`] = "object";
      } else if (name === "require") {
        assumptions[`typeof ${name}`] = "function";
      }
    } else {
      if (name === "window" || name === "document" || name === "self" || name === "Intl") {
        assumptions[`typeof ${name}`] = "object";
      } else if (
        name === "process" ||
        name === "module" ||
        name === "exports" ||
        name === "require" ||
        name === "define"
      ) {
        assumptions[`typeof ${name}`] = "undefined";
      }
    }
  }
  if (target === "node") {
    for (let k of processEnvKeys) {
      let v = typeof process !== "undefined" && process.env ? process.env[k] : undefined;
      assumptions[`process.env.${k}`] = v === undefined ? UNDEFINED_SENTINEL : v;
    }
  }
  if (usesDate) {
    let jan = new Date(0).getTimezoneOffset();
    let jul = new Date(1593561600000).getTimezoneOffset();
    if (jan === jul) {
      assumptions.timezoneOffset = jan;
    }
  }
  return assumptions;
}
