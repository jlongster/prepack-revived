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
import type { CompilerDiagnostic, ErrorHandlerResult } from "../errors.js";
import { FatalError } from "../errors.js";
import { PropertyDescriptor } from "../descriptors.js";
import {
  AbstractValue,
  BooleanValue,
  ECMAScriptSourceFunctionValue,
  FunctionValue,
  NumberValue,
  ObjectValue,
  PrimitiveValue,
  StringValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { SimpleNormalCompletion } from "../completions.js";
import { Generator, TemporalOperationEntry } from "../utils/generator.js";
import { isInsidePureProbe, tryEmitPureResidualCall } from "./recursion.js";
import traverseFast from "../utils/traverse-fast.js";
import invariant from "../invariant.js";
import type { BabelNode } from "@babel/types";

let staticCallCountsCache: WeakMap<BabelNode, Map<string, number>> = new WeakMap();
let dynamicCallCounts: WeakMap<
  Realm,
  { optRoot: void | FunctionValue, counts: Map<ECMAScriptSourceFunctionValue, number> }
> = new WeakMap();
let speculativeInlineSet: WeakSet<ECMAScriptSourceFunctionValue> = new WeakSet();

function getStaticCallCounts(code: BabelNode): Map<string, number> {
  let cached = staticCallCountsCache.get(code);
  if (cached !== undefined) return cached;
  let counts: Map<string, number> = new Map();
  traverseFast(code, (node: any) => {
    if (node.type === "CallExpression" && node.callee && node.callee.type === "Identifier") {
      let name = node.callee.name;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return false;
  });
  staticCallCountsCache.set(code, counts);
  return counts;
}

export function isRetainedOnGlobalObject(realm: Realm, fn: FunctionValue): boolean {
  let globalObj = realm.$GlobalObject;
  if (!(globalObj instanceof ObjectValue)) return false;
  if (fn.__originalName !== undefined) {
    let pb = globalObj.properties.get(fn.__originalName);
    let desc = pb && pb.descriptor;
    if (desc instanceof PropertyDescriptor && desc.value === fn) return true;
  }
  for (let pb of globalObj.properties.values()) {
    let desc = pb && pb.descriptor;
    if (desc instanceof PropertyDescriptor && desc.value === fn) return true;
  }
  return false;
}

function generatorContainsResidualLoop(gen: Generator): boolean {
  for (let entry of gen._entries) {
    if (entry instanceof TemporalOperationEntry && entry.operationDescriptor.type === "FOR_STATEMENT_FUNC") return true;
    let deps = entry.getDependencies();
    if (deps !== undefined) {
      for (let dep of deps) {
        if (generatorContainsResidualLoop(dep)) return true;
      }
    }
  }
  return false;
}

function countGeneratorOperations(gen: Generator): number {
  let total = 0;
  for (let entry of gen._entries) {
    total++;
    if (entry instanceof TemporalOperationEntry) {
      let deps = entry.getDependencies();
      if (deps !== undefined) {
        for (let dep of deps) total += countGeneratorOperations(dep);
      }
    }
  }
  return total;
}

export function tryAvoidInliningExplosion(
  realm: Realm,
  F: FunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): void | Value {
  if (
    !realm.useAbstractInterpretation ||
    realm.residualCallHeuristics === false ||
    !realm.isInPureScope() ||
    realm.instantRender.enabled ||
    realm.react.enabled ||
    isInsidePureProbe(realm) ||
    !(F instanceof ECMAScriptSourceFunctionValue) ||
    F.$FunctionKind !== "normal" ||
    speculativeInlineSet.has(F)
  ) {
    return undefined;
  }

  let optRoot = realm.currentOptimizedFunction;
  if (F === optRoot || realm.getRunningContext().function === undefined) {
    return undefined;
  }
  if (realm.residualCallHeuristics === "loops") return tryResidualizeLoopingCall(realm, F, thisArgument, argsList);

  let hasAbstractArg = argsList.some(arg => arg instanceof AbstractValue);
  if (!hasAbstractArg) return undefined;

  let code = F.$ECMAScriptCode;
  if (!code || code.start == null || code.end == null) return undefined;
  let bodyBytes = code.end - code.start;
  if (bodyBytes < 100) return undefined;

  // Track dynamic call count of F within the current optimized root evaluation.
  let tracker = dynamicCallCounts.get(realm);
  if (tracker === undefined || tracker.optRoot !== optRoot) {
    tracker = { optRoot, counts: new Map() };
    dynamicCallCounts.set(realm, tracker);
  }
  let dynCount = (tracker.counts.get(F) || 0) + 1;
  tracker.counts.set(F, dynCount);

  // Heuristic 1 (#2140): Repeated calls to a branching helper with abstract arguments.
  let staticCalls = 0;
  let fnName = F.__originalName;
  if (optRoot instanceof ECMAScriptSourceFunctionValue && optRoot.$ECMAScriptCode && fnName !== undefined) {
    staticCalls = getStaticCallCounts(optRoot.$ECMAScriptCode).get(fnName) || 0;
  }
  if ((staticCalls >= 4 && staticCalls * bodyBytes >= 750) || (dynCount >= 3 && dynCount * bodyBytes >= 750)) {
    let residual = tryEmitPureResidualCall(realm, F, thisArgument, argsList);
    if (residual !== undefined) return residual;
  }

  // Heuristic 2 (#1959): Large helper already retained on global object, called with all-abstract
  // arguments, whose specialization still emits a residual loop and substantial branching prelude.
  if (
    bodyBytes >= 240 &&
    argsList.length > 0 &&
    argsList.every(arg => arg instanceof AbstractValue) &&
    isRetainedOnGlobalObject(realm, F)
  ) {
    let call = F.$Call;
    invariant(call !== undefined);
    let savedErrorHandler = realm.errorHandler;
    let bufferedDiagnostics: Array<[CompilerDiagnostic, boolean]> = [];
    realm.errorHandler = (diagnostic, suppress): ErrorHandlerResult => {
      bufferedDiagnostics.push([diagnostic, suppress]);
      if (diagnostic.severity === "Information" || diagnostic.severity === "Warning") return "Recover";
      return "Fail";
    };
    speculativeInlineSet.add(F);
    let effects;
    try {
      effects = realm.evaluateForEffects(
        () => call(thisArgument, argsList),
        undefined,
        "speculative inlining cost check"
      );
    } catch (e) {
      speculativeInlineSet.delete(F);
      realm.errorHandler = savedErrorHandler;
      if (e instanceof FatalError) {
        let savedSuppress = realm.suppressDiagnostics;
        try {
          for (let [d, sup] of bufferedDiagnostics) {
            realm.suppressDiagnostics = sup;
            realm.handleError(d);
          }
        } finally {
          realm.suppressDiagnostics = savedSuppress;
        }
      }
      throw e;
    } finally {
      speculativeInlineSet.delete(F);
      realm.errorHandler = savedErrorHandler;
    }

    if (generatorContainsResidualLoop(effects.generator) && countGeneratorOperations(effects.generator) >= 3) {
      let residual = tryEmitPureResidualCall(realm, F, thisArgument, argsList);
      if (residual !== undefined) return residual;
    }

    let savedSuppress = realm.suppressDiagnostics;
    try {
      for (let [d, sup] of bufferedDiagnostics) {
        realm.suppressDiagnostics = sup;
        if (realm.handleError(d) === "Fail") throw new FatalError();
      }
    } finally {
      realm.suppressDiagnostics = savedSuppress;
    }
    realm.applyEffects(effects);
    return realm.returnOrThrowCompletion(effects.result);
  }

  return undefined;
}

function isPrimitiveValue(value: Value): boolean {
  if (value instanceof AbstractValue) return Value.isTypeCompatibleWith(value.getType(), PrimitiveValue);
  return value instanceof PrimitiveValue;
}

// A call with primitive arguments (at least one abstract) whose specialization would contain a
// residual loop becomes a residual call of F, if F is pure and always returns a primitive of one
// type: the loop then runs inside the original function instead of a specialized copy of it (with
// its own closure and leaked variables) at every call site. The result keeps the type established
// by the speculative evaluation.
function tryResidualizeLoopingCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): void | Value {
  if (!(thisArgument instanceof UndefinedValue) && F.$ThisMode !== "lexical") return undefined;
  if (!argsList.every(isPrimitiveValue) || !argsList.some(arg => arg instanceof AbstractValue)) return undefined;
  let call = F.$Call;
  invariant(call !== undefined);
  let savedErrorHandler = realm.errorHandler;
  realm.errorHandler = (diagnostic): ErrorHandlerResult =>
    diagnostic.severity === "Information" || diagnostic.severity === "Warning" ? "Recover" : "Fail";
  speculativeInlineSet.add(F);
  let effects;
  try {
    effects = realm.evaluateForEffects(() => call(thisArgument, argsList), undefined, "speculative loop check");
  } catch (e) {
    if (e instanceof FatalError) return undefined;
    throw e;
  } finally {
    speculativeInlineSet.delete(F);
    realm.errorHandler = savedErrorHandler;
  }
  let result = effects.result;
  let resultType = result instanceof SimpleNormalCompletion ? result.value.getType() : undefined;
  if (
    resultType !== undefined &&
    !Value.isTypeCompatibleWith(resultType, ObjectValue) &&
    generatorContainsResidualLoop(effects.generator)
  ) {
    let residual = tryEmitPureResidualCall(realm, F, thisArgument, argsList);
    if (residual instanceof AbstractValue) {
      let precise =
        resultType === StringValue ||
        resultType === BooleanValue ||
        Value.isTypeCompatibleWith(resultType, NumberValue);
      return precise ? AbstractValue.createShapeView(realm, residual, resultType, undefined) : residual;
    }
  }
  // Use the speculative evaluation as the evaluation of the call.
  realm.applyEffects(effects);
  return realm.returnOrThrowCompletion(result);
}
