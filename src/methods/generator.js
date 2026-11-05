/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { Realm } from "../realm.js";
import { AbruptCompletion, ReturnCompletion } from "../completions.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import {
  ECMAScriptSourceFunctionValue,
  FunctionValue,
  ObjectValue,
  StringValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { Environment } from "../singletons.js";
import { Call } from "./call.js";
import { Get } from "./get.js";
import parse from "../utils/parse.js";
import traverseFast from "../utils/traverse-fast.js";
import invariant from "../invariant.js";
import * as t from "@babel/types";
import generate from "@babel/generator";
import * as babel from "@babel/core";
import fs from "fs";
import type { BabelNodeBlockStatement } from "@babel/types";

let cachedRuntimeSource: void | string;
const realmRegeneratorRuntimes: WeakMap<Realm, ObjectValue> = new WeakMap();
const loweredGeneratorCodeCache: WeakMap<BabelNodeBlockStatement, string> = new WeakMap();

function failGeneratorOp(realm: Realm, message: string): empty {
  let diag = new CompilerDiagnostic(message, realm.currentLocation, "PP0001", "FatalError");
  realm.handleError(diag);
  throw new FatalError();
}

function getRegeneratorRuntimeSource(): string {
  if (cachedRuntimeSource === undefined) {
    let runtimePath = require.resolve("regenerator-runtime/runtime.js");
    let raw = fs.readFileSync(runtimePath, "utf8");
    let needle = '(function() { return this })() || Function("return this")()';
    invariant(raw.includes(needle), "unexpected regenerator-runtime/runtime.js format");
    let body = raw.replace(needle, "{}");
    cachedRuntimeSource = `(function() {\nvar module = { exports: {} };\n${body}\nreturn module.exports;\n})()`;
  }
  return cachedRuntimeSource;
}

function getOrCreateRealmRegeneratorRuntime(realm: Realm): ObjectValue {
  let existing = realmRegeneratorRuntimes.get(realm);
  if (existing !== undefined) return existing;
  let ast;
  try {
    ast = parse(realm, getRegeneratorRuntimeSource(), "regenerator-runtime");
  } catch (_e) {
    failGeneratorOp(realm, "Failed to parse internal generator runtime");
  }
  let ctx = realm.createExecutionContext();
  ctx.lexicalEnvironment = realm.$GlobalEnv;
  ctx.variableEnvironment = realm.$GlobalEnv;
  ctx.realm = realm;
  realm.pushContext(ctx);
  let res;
  try {
    res = realm.evaluateWithoutEffects(() => realm.$GlobalEnv.evaluateCompletionDeref(ast, false));
  } finally {
    realm.popContext(ctx);
  }
  if (res instanceof AbruptCompletion || !(res instanceof ObjectValue)) {
    throw failGeneratorOp(realm, "Failed to initialize internal generator runtime");
  }
  realmRegeneratorRuntimes.set(realm, res);
  return res;
}

function containsSuperReference(F: ECMAScriptSourceFunctionValue): boolean {
  let found = false;
  let check = node => {
    if (node.type === "Super") {
      found = true;
      return true;
    }
    return (
      node.type === "ClassExpression" ||
      node.type === "ClassDeclaration" ||
      node.type === "ObjectMethod" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration"
    );
  };
  for (let p of F.$FormalParameters) traverseFast(p, check);
  if (!found && F.$ECMAScriptCode) traverseFast(F.$ECMAScriptCode, check);
  return found;
}

function getLoweredGeneratorFactorySource(F: ECMAScriptSourceFunctionValue): string {
  let code = F.$ECMAScriptCode;
  invariant(code !== undefined);
  let cached = loweredGeneratorCodeCache.get(code);
  if (cached !== undefined) return cached;

  let directives = (code.directives || []).slice();
  if (F.$Strict && !directives.some(d => d.value && d.value.value === "use strict")) {
    directives.unshift(t.directive(t.directiveLiteral("use strict")));
  }
  let bodyNode = t.blockStatement(code.body, directives);
  let genExpr = t.functionExpression(null, F.$FormalParameters, bodyNode, true, false);
  let declProg = t.program([t.variableDeclaration("var", [t.variableDeclarator(t.identifier("__pp_gen"), genExpr)])]);
  let rawSrc = generate(declProg).code;
  let transformed = babel.transformSync(rawSrc, {
    configFile: false,
    babelrc: false,
    plugins: [
      "@babel/plugin-transform-parameters",
      "@babel/plugin-transform-destructuring",
      "@babel/plugin-transform-for-of",
      "@babel/plugin-transform-spread",
      "@babel/plugin-transform-block-scoping",
      "@babel/plugin-transform-regenerator",
    ],
  });
  invariant(transformed && typeof transformed.code === "string");
  let factorySrc = `(function(regeneratorRuntime) {\n${transformed.code}\nreturn __pp_gen;\n})`;
  loweredGeneratorCodeCache.set(code, factorySrc);
  return factorySrc;
}

export function evaluateGeneratorCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisValue: Value,
  argumentsList: Array<Value>
): ObjectValue {
  if (realm.isInPureScope()) {
    failGeneratorOp(realm, "Calling a generator function in pure scope is residualized");
  }
  if (!realm.pathConditions.isEmpty() || realm.savedCompletion !== undefined) {
    failGeneratorOp(realm, "Calling a generator function under abstract conditions is not supported");
  }
  if (containsSuperReference(F)) {
    failGeneratorOp(realm, "Calling a generator method using super during initialization is not supported");
  }

  let factorySrc;
  try {
    // The lowering needs regenerator-runtime and Babel's ES2015 transform plugins at Prepack runtime.
    getRegeneratorRuntimeSource();
    factorySrc = getLoweredGeneratorFactorySource(F);
  } catch (e) {
    if (e instanceof FatalError) throw e;
    throw failGeneratorOp(
      realm,
      "Calling a generator function during initialization requires the regenerator lowering: " + e.message
    );
  }
  let runtimeObj = getOrCreateRealmRegeneratorRuntime(realm);
  let factoryAst;
  try {
    factoryAst = parse(realm, factorySrc, "lowered-generator");
  } catch (_e) {
    throw failGeneratorOp(realm, "Failed to parse lowered generator body");
  }
  let closureEnv = F.$Environment;
  invariant(closureEnv !== undefined);

  let factoryVal;
  let ctx = realm.createExecutionContext();
  ctx.lexicalEnvironment = closureEnv;
  ctx.variableEnvironment = closureEnv;
  ctx.realm = realm;
  realm.pushContext(ctx);
  try {
    let evalRes = closureEnv.evaluateCompletion((factoryAst.program.body[0]: any).expression, F.$Strict);
    if (evalRes instanceof AbruptCompletion) throw evalRes;
    factoryVal = Environment.GetValue(realm, evalRes);
  } finally {
    realm.popContext(ctx);
  }
  invariant(factoryVal instanceof FunctionValue);
  let loweredFn = Call(realm, factoryVal, realm.intrinsics.undefined, [runtimeObj]);
  invariant(loweredFn instanceof FunctionValue);
  let genObj = Call(realm, loweredFn, thisValue, argumentsList);
  invariant(genObj instanceof ObjectValue);

  let invokeFn = Get(realm, genObj, "_invoke");
  invariant(invokeFn instanceof FunctionValue);
  genObj.properties.delete("_invoke");
  genObj.$RegeneratorInvoke = invokeFn;
  genObj.$GeneratorState = "suspendedStart";
  genObj.$GeneratorContext = undefined;

  let proto = Get(realm, F, "prototype");
  if (proto instanceof ObjectValue) {
    genObj.$Prototype = proto;
  }
  return genObj;
}

// ECMA26225.3.3.1
export function GeneratorStart(
  realm: Realm,
  generator: ObjectValue,
  generatorBody: BabelNodeBlockStatement
): UndefinedValue {
  invariant(realm.isNewObject(generator));
  invariant(
    generator instanceof ObjectValue && generator.$GeneratorState === undefined,
    "The value of generator.[[GeneratorState]] is undefined"
  );
  let genContext = realm.getRunningContext();
  generator.$GeneratorContext = genContext;
  generator.$GeneratorState = "suspendedStart";
  return realm.intrinsics.undefined;
}

// ECMA26225.3.3.2
export function GeneratorValidate(realm: Realm, generator: Value): void | "suspendedStart" | "executing" {
  if (!(generator instanceof ObjectValue)) {
    throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "Type(generator) is not Object");
  }
  if (generator.$GeneratorState === undefined) {
    throw realm.createErrorThrowCompletion(
      realm.intrinsics.TypeError,
      "Generator method called on incompatible receiver"
    );
  }
  let state = generator.$GeneratorState;
  if (state === "executing") {
    throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "Generator is already running");
  }
  return state;
}

function stepRegenerator(realm: Realm, generator: ObjectValue, method: "next" | "return" | "throw", arg: Value): Value {
  if (realm.isInPureScope()) {
    failGeneratorOp(realm, "Advancing a generator in pure scope is not supported");
  }
  if (!realm.pathConditions.isEmpty() || realm.savedCompletion !== undefined) {
    failGeneratorOp(realm, "Advancing a generator under abstract conditions is not supported");
  }
  let invokeFn = generator.$RegeneratorInvoke;
  if (invokeFn === undefined) {
    throw failGeneratorOp(realm, "Resuming a generator during initialization is not supported");
  }
  generator.$GeneratorState = "executing";
  try {
    let res = Call(realm, invokeFn, generator, [new StringValue(realm, method), arg]);
    if (realm.savedCompletion !== undefined) {
      failGeneratorOp(realm, "Generator body with conditional abrupt completion is not supported");
    }
    return res;
  } finally {
    generator.$GeneratorState = "suspendedStart";
  }
}

// ECMA26225.3.3.3
export function GeneratorResume(realm: Realm, generator: Value, value: Value): Value {
  GeneratorValidate(realm, generator);
  invariant(generator instanceof ObjectValue);
  return stepRegenerator(realm, generator, "next", value);
}

// ECMA26225.3.3.4
export function GeneratorResumeAbrupt(realm: Realm, generator: Value, abruptCompletion: AbruptCompletion): Value {
  GeneratorValidate(realm, generator);
  invariant(generator instanceof ObjectValue);
  let method = abruptCompletion instanceof ReturnCompletion ? "return" : "throw";
  return stepRegenerator(realm, generator, method, abruptCompletion.value);
}

// ECMA26225.3.3.5
export function GeneratorYield(realm: Realm, iterNextObj: ObjectValue): Value {
  return realm.intrinsics.undefined;
}
