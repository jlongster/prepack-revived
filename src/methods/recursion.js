/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

// Residualization of recursion whose depth depends on abstract values (#543, #1586).
// See docs/revive/recursion.md for the design and the soundness argument.

import type { Realm } from "../realm.js";
import { Effects } from "../realm.js";
import type { Binding } from "../environment.js";
import type { PathConditions } from "../types.js";
import type {
  BabelNodeExpression,
  BabelNodeLVal,
  BabelNodeSourceLocation,
  BabelNodeVariableDeclaration,
} from "@babel/types";
import type { ErrorHandlerResult } from "../errors.js";
import {
  DeclarativeEnvironmentRecord,
  EnvironmentRecord,
  FunctionEnvironmentRecord,
  GlobalEnvironmentRecord,
  ObjectEnvironmentRecord,
} from "../environment.js";
import {
  AbstractValue,
  BooleanValue,
  ECMAScriptSourceFunctionValue,
  EmptyValue,
  FunctionValue,
  NullValue,
  NumberValue,
  ObjectValue,
  PrimitiveValue,
  StringValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { PropertyDescriptor } from "../descriptors.js";
import {
  Completion,
  JoinedAbruptCompletions,
  JoinedNormalAndAbruptCompletions,
  SimpleNormalCompletion,
} from "../completions.js";
import { TestIntegrityLevel } from "./integrity.js";
import { Leak } from "../singletons.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { createOperationDescriptor, Generator, TemporalOperationEntry } from "../utils/generator.js";
import invariant from "../invariant.js";
import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { BabelTraversePath } from "@babel/traverse";

// While the arguments of a re-entered call are all concrete and changing (e.g. nested require(0) -> require(1)),
// keep unrolling up to this many nested activations of the same function before residualizing.
const CONCRETE_UNROLL_LIMIT = 8;
// Global code: the maximum number of objects whose state a residual call may read.
const MAX_SNAPSHOT_OBJECTS = 200;

type Activation = { pathConditions: PathConditions, args: Array<Value> };

type StaticInfo = {
  freeReads: Set<string>,
  freeWrites: Set<string>,
  memberWriteBases: Set<string>, // free identifiers that are the base of a property write or delete
  hasMemberWrite: boolean,
  unsupported: void | string,
};

type Snapshot = {
  active: Binding,
  location: ?BabelNodeSourceLocation,
  functionName: string,
  bindings: Array<[Binding, Value]>,
  properties: Array<[ObjectValue, string, mixed]>,
  propertyCounts: Array<[ObjectValue, number]>,
  prototypes: Array<[ObjectValue, Value]>,
};

type ClusterCheckResult =
  | { ok: true, snapshot: Snapshot, leakedFunctions: Array<ECMAScriptSourceFunctionValue> }
  | { ok: false, reason: string };
type ProveTypeResult = { ok: true, resultType: typeof Value } | { ok: false, reason: string };

// Marks FatalErrors thrown when a residual recursive call would be unsound. Call sites in pure scope
// must not recover from these by leaving the call abstract, since that would make the same unsound assumption.
let unsoundRecursionErrors: WeakSet<FatalError> = new WeakSet();

export function isUnsoundResidualRecursionError(error: mixed): boolean {
  return error instanceof FatalError && unsoundRecursionErrors.has(error);
}

let activations: WeakMap<ECMAScriptSourceFunctionValue, Array<Activation>> = new WeakMap();
let staticInfoCache: WeakMap<{}, StaticInfo> = new WeakMap();
let pendingSnapshots: WeakMap<Realm, Array<Snapshot>> = new WeakMap();
let tryDepths: WeakMap<Realm, number> = new WeakMap();
// Result types assumed for nested calls while a probe of the function with these argument types runs.
let hypotheses: WeakMap<ECMAScriptSourceFunctionValue, Map<string, typeof Value>> = new WeakMap();
let probeDepth: WeakMap<Realm, number> = new WeakMap();
// Result types proven by probes, per path condition.
let proven: WeakMap<PathConditions, Map<string, typeof Value>> = new WeakMap();
// Functions currently undergoing a one-step effect check in pure scope.
let pureProving: WeakSet<ECMAScriptSourceFunctionValue> = new WeakSet();
let bypass: void | ECMAScriptSourceFunctionValue;
let totalResidualizations: WeakMap<Realm, number> = new WeakMap();

// Whether F can reach itself through the functions that its free variables currently refer to,
// and whether any variable read along that cluster holds an abstract or leaked value.
function analyzeCycle(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue
): { isRecursive: boolean, readsAbstractState: boolean } {
  let worklist = [F];
  let visited = new Set(worklist);
  let isRecursive = false;
  let readsAbstractState = false;
  while (worklist.length > 0) {
    let fn = worklist.pop();
    let info = getStaticInfo(fn);
    for (let name of info.freeReads) {
      let resolved = resolveFreeName(realm, fn, name, undefined, false);
      if (typeof resolved === "string") continue;
      let value;
      if (resolved.binding !== undefined) {
        if (resolved.binding.hasLeaked) readsAbstractState = true;
        value = resolved.binding.value;
      } else if (resolved.globalObject !== undefined) {
        let propertyBinding = resolved.globalObject.properties.get(name);
        let descriptor = propertyBinding === undefined ? undefined : propertyBinding.descriptor;
        if (descriptor instanceof PropertyDescriptor) value = descriptor.value;
      }
      if (value instanceof AbstractValue) readsAbstractState = true;
      if (value === F) isRecursive = true;
      if (value instanceof ECMAScriptSourceFunctionValue && !value.isIntrinsic() && !visited.has(value)) {
        visited.add(value);
        worklist.push(value);
      }
    }
  }
  return { isRecursive, readsAbstractState };
}

export function enterTryBlock(realm: Realm): void {
  tryDepths.set(realm, (tryDepths.get(realm) || 0) + 1);
}

export function exitTryBlock(realm: Realm): void {
  tryDepths.set(realm, (tryDepths.get(realm) || 1) - 1);
}

export function isInTryBlock(realm: Realm): boolean {
  return (tryDepths.get(realm) || 0) > 0;
}

let pureProbeDepth: WeakMap<Realm, number> = new WeakMap();

export function isInsidePureProbe(realm: Realm): boolean {
  return (pureProbeDepth.get(realm) || 0) > 0;
}

// Runs a call of F, keeping track of active calls so that re-entries can be detected.
export function withActivation<T>(realm: Realm, F: FunctionValue, argsList: Array<Value>, f: () => T): T {
  if (!(F instanceof ECMAScriptSourceFunctionValue) || !realm.useAbstractInterpretation) return f();
  let stack = activations.get(F);
  if (stack === undefined) activations.set(F, (stack = []));
  stack.push({ pathConditions: realm.pathConditions, args: argsList });
  try {
    return f();
  } finally {
    stack.pop();
  }
}

function sameConcreteArgs(a: Array<Value>, b: Array<Value>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// If F is being re-entered and the recursion is driven by abstract values, returns an abstract value
// for a residual call of F instead of unrolling the recursion. Returns undefined to evaluate the call normally.
export function tryResidualizeRecursiveCall(
  realm: Realm,
  F: FunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): void | Value {
  if (!(F instanceof ECMAScriptSourceFunctionValue) || F.$FunctionKind !== "normal") return undefined;
  if (!realm.useAbstractInterpretation || realm.instantRender.enabled) return undefined;
  if (bypass === F) {
    // The top-level call of a speculative or probe evaluation.
    bypass = undefined;
    return undefined;
  }
  let stack = activations.get(F);
  if (stack === undefined || stack.length === 0) return speculateOutermostCall(realm, F, thisArgument, argsList);
  // Recursion is driven by abstract values if the re-entry happens on a path that is guarded by
  // conditions that were assumed after the enclosing call of F started.
  let top = stack[stack.length - 1];
  let formalLen = Math.max(1, F.$FormalParameters ? F.$FormalParameters.length : 1);
  let relevantArgs = argsList.slice(0, formalLen);
  let transitionedToUntypedAbstract =
    !top.args.slice(0, formalLen).some(a => a instanceof AbstractValue) &&
    relevantArgs.some(a => a instanceof AbstractValue && a.getType() === Value && a.kind !== "conditional");
  if (realm.pathConditions === top.pathConditions && !transitionedToUntypedAbstract) return undefined;
  let abstractArgs = argsList.some(arg => arg instanceof AbstractValue);
  if (!abstractArgs && !sameConcreteArgs(top.args, argsList) && stack.length < CONCRETE_UNROLL_LIMIT) return undefined;

  return emitResidualCall(realm, F, thisArgument, argsList);
}

function generatorReferencesValue(gen: Generator, target: Value): boolean {
  for (let entry of gen._entries) {
    if (entry instanceof TemporalOperationEntry && entry.args.includes(target)) return true;
    let deps = entry.getDependencies();
    if (deps !== undefined) {
      for (let dep of deps) {
        if (generatorReferencesValue(dep, target)) return true;
      }
    }
  }
  return false;
}

// The outermost call of a recursive function driven by abstract inputs is evaluated speculatively: if its
// recursion turns out to be driven by abstract values, the call itself becomes a residual call too, rather
// than an inlined copy of the function body around nested residual calls.
function speculateOutermostCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): void | Value {
  // Never replace the body of a root function that Prepack itself is optimizing with a self-call.
  if (
    realm.isInPureScope() &&
    (F === realm.currentOptimizedFunction || realm.getRunningContext().function === undefined)
  ) {
    return undefined;
  }
  let hasAbstractArg = argsList.some(arg => arg instanceof AbstractValue);
  let cycle = analyzeCycle(realm, F);
  if (!cycle.isRecursive || (!hasAbstractArg && !cycle.readsAbstractState)) return undefined;

  let before = totalResidualizations.get(realm) || 0;
  let call = F.$Call;
  invariant(call !== undefined);
  let savedErrorHandler = realm.errorHandler;
  let bufferedDiagnostics: Array<[CompilerDiagnostic, boolean]> = [];
  realm.errorHandler = (diagnostic, suppress): ErrorHandlerResult => {
    bufferedDiagnostics.push([diagnostic, suppress]);
    if (diagnostic.severity === "Information" || diagnostic.severity === "Warning") return "Recover";
    return "Fail";
  };
  bypass = F;
  let effects;
  try {
    effects = realm.evaluateForEffects(() => call(thisArgument, argsList), undefined, "speculative recursive call");
  } catch (e) {
    realm.errorHandler = savedErrorHandler;
    if (e instanceof FatalError) replayDiagnostics(realm, bufferedDiagnostics, false);
    throw e;
  } finally {
    bypass = undefined;
    realm.errorHandler = savedErrorHandler;
  }
  let leakedSelfWithStatements =
    hasAbstractArg &&
    realm.isInPureScope() &&
    effects.generator._entries.length > 0 &&
    (generatorReferencesValue(effects.generator, F) ||
      realm.withEffectsAppliedInGlobalEnv(() => !F.mightNotBeLeakedObject(), effects));
  if ((totalResidualizations.get(realm) || 0) === before && !leakedSelfWithStatements) {
    replayDiagnostics(realm, bufferedDiagnostics, true);
    realm.applyEffects(effects);
    return realm.returnOrThrowCompletion(effects.result);
  }
  return emitResidualCall(realm, F, thisArgument, argsList);
}

function replayDiagnostics(
  realm: Realm,
  diagnostics: Array<[CompilerDiagnostic, boolean]>,
  throwOnFail: boolean
): void {
  let savedSuppress = realm.suppressDiagnostics;
  try {
    for (let [diagnostic, suppress] of diagnostics) {
      realm.suppressDiagnostics = suppress;
      if (realm.handleError(diagnostic) === "Fail" && throwOnFail) throw new FatalError();
    }
  } finally {
    realm.suppressDiagnostics = savedSuppress;
  }
}

// Attempts to emit a sound residual call to F in pure scope for size/inlining control.
// Unlike emitResidualCall (which aborts with PP0050 when unbounded recursion cannot be safely residualized),
// this helper rolls back cleanly and returns undefined so the caller falls back to normal inlining.
export function tryEmitPureResidualCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): void | Value {
  if (!realm.isInPureScope() || realm.instantRender.enabled) return undefined;
  let clusterCheck = checkCluster(realm, F, thisArgument, argsList, true);
  if (!clusterCheck.ok) return undefined;

  let callArgs;
  let descriptor;
  if (thisArgument instanceof UndefinedValue || F.$ThisMode === "lexical") {
    callArgs = [F, ...argsList];
    descriptor = createOperationDescriptor("CALL_BAILOUT", { propRef: undefined, thisArg: undefined });
  } else {
    callArgs = [F, thisArgument, ...argsList];
    descriptor = createOperationDescriptor("CALL_BAILOUT", { propRef: "call", thisArg: F });
  }

  let pureFailure;
  let effects = realm.evaluateForEffects(
    () => {
      Leak.value(realm, F, realm.currentLocation);
      for (let arg of argsList) Leak.value(realm, arg, realm.currentLocation);
      if (callArgs.length > argsList.length + 1) Leak.value(realm, thisArgument, realm.currentLocation);
      if (!pureProving.has(F)) {
        pureFailure = verifyPureCallEffects(realm, F, thisArgument, argsList, clusterCheck.leakedFunctions);
      }
      if (pureFailure !== undefined) return realm.intrinsics.undefined;
      return realm.evaluateWithPossibleThrowCompletion(
        () => AbstractValue.createTemporalFromBuildFunction(realm, Value, callArgs, descriptor),
        TypesDomain.topVal,
        ValuesDomain.topVal
      );
    },
    undefined,
    "tryEmitPureResidualCall"
  );

  if (pureFailure !== undefined || !(effects.result instanceof SimpleNormalCompletion)) {
    return undefined;
  }
  realm.applyEffects(effects);
  return effects.result.value;
}

function emitResidualCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): Value {
  totalResidualizations.set(realm, (totalResidualizations.get(realm) || 0) + 1);
  let pure = realm.isInPureScope();
  let clusterCheck = checkCluster(realm, F, thisArgument, argsList, pure);
  if (!clusterCheck.ok) return reportFailure(realm, F, clusterCheck.reason);

  let callArgs;
  let descriptor;
  if (thisArgument instanceof UndefinedValue || F.$ThisMode === "lexical") {
    callArgs = [F, ...argsList];
    descriptor = createOperationDescriptor("CALL_BAILOUT", { propRef: undefined, thisArg: undefined });
  } else {
    // F.call(thisArgument, ...argsList)
    callArgs = [F, thisArgument, ...argsList];
    descriptor = createOperationDescriptor("CALL_BAILOUT", { propRef: "call", thisArg: F });
  }

  if (pure) {
    // The residual call may read and write everything created in this pure scope that is reachable from
    // the function and its arguments: materialize and havoc it, as for calls to unknown functions.
    Leak.value(realm, F, realm.currentLocation);
    for (let arg of argsList) Leak.value(realm, arg, realm.currentLocation);
    if (callArgs.length > argsList.length + 1) Leak.value(realm, thisArgument, realm.currentLocation);
    if (!pureProving.has(F)) {
      let pureFailure = verifyPureCallEffects(realm, F, thisArgument, argsList, clusterCheck.leakedFunctions);
      if (pureFailure !== undefined) return reportFailure(realm, F, pureFailure);
    }
    return realm.evaluateWithPossibleThrowCompletion(
      () => AbstractValue.createTemporalFromBuildFunction(realm, Value, callArgs, descriptor),
      TypesDomain.topVal,
      ValuesDomain.topVal
    );
  }

  let snapshot = clusterCheck.snapshot;
  let provenType = proveResultType(realm, F, thisArgument, argsList, snapshot);
  if (!provenType.ok) return reportFailure(realm, F, provenType.reason);
  if (!isInsideProbe(realm)) {
    // Mark the snapshot active in Prepack's transactional binding log so rolled-back speculative evaluations ignore it.
    realm.recordModifiedBinding(snapshot.active);
    snapshot.active.value = realm.intrinsics.true;
    let snapshots = pendingSnapshots.get(realm);
    if (snapshots === undefined) pendingSnapshots.set(realm, (snapshots = []));
    snapshots.push(snapshot);
  }
  return AbstractValue.createTemporalFromBuildFunction(realm, provenType.resultType, callArgs, descriptor);
}

function reportFailure(realm: Realm, F: ECMAScriptSourceFunctionValue, reason: string): empty {
  let name = functionName(F);
  let diagnostic = new CompilerDiagnostic(
    `recursion of ${name} depends on abstract values, and a residual call of ${name} cannot be emitted: ${reason}`,
    realm.currentLocation,
    "PP0050",
    "FatalError"
  );
  let savedSuppressDiagnostics = realm.suppressDiagnostics;
  realm.suppressDiagnostics = false;
  try {
    realm.handleError(diagnostic);
  } finally {
    realm.suppressDiagnostics = savedSuppressDiagnostics;
  }
  let error = new FatalError();
  unsoundRecursionErrors.add(error);
  throw error;
}

// Pure scope: leaking F and its arguments only havocs objects and bindings created in the current pure scope.
// Evaluate one abstract step of F against the leaked state to ensure it cannot modify any untracked or non-leaked
// object or binding (for instance, mutating a global array via .push or an outer object reached via a property).
function verifyPureCallEffects(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>,
  leakedFunctions: Array<ECMAScriptSourceFunctionValue>
): void | string {
  let firstEnvId = EnvironmentRecord.nextId;
  let savedErrorHandler = realm.errorHandler;
  let savedSuppress = realm.suppressDiagnostics;
  let sawFatalDiagnostic = false;
  realm.errorHandler = d => {
    if (d.severity === "Information" || d.severity === "Warning") return "Recover";
    if (d.severity === "FatalError") sawFatalDiagnostic = true;
    return "Fail";
  };
  realm.suppressDiagnostics = false;
  pureProving.add(F);
  for (let fn of leakedFunctions) pureProving.add(fn);
  pureProbeDepth.set(realm, (pureProbeDepth.get(realm) || 0) + 1);
  let rootEffects: Array<[ECMAScriptSourceFunctionValue, Effects]> = [];
  try {
    let fCall = F.$Call;
    invariant(fCall !== undefined);
    let probeArgs = argsList.map(arg => {
      if (!(arg instanceof PrimitiveValue)) return arg;
      let argType = arg.getType();
      let probeType = argType === NullValue || argType === UndefinedValue || argType === EmptyValue ? Value : argType;
      return AbstractValue.createAbstractArgument(realm, "__recursionPureProbe", realm.currentLocation, probeType);
    });
    bypass = F;
    let mainEffects = realm.evaluateForEffects(
      () => fCall(thisArgument, probeArgs),
      undefined,
      "residual recursion pure probe"
    );
    if (sawFatalDiagnostic) return `evaluating ${functionName(F)} with abstract arguments fails`;
    rootEffects.push([F, mainEffects]);

    for (let fn of leakedFunctions) {
      if (fn === F) continue;
      let fnCall = fn.$Call;
      invariant(fnCall !== undefined);
      let paramCount = fn.$FormalParameters ? fn.$FormalParameters.length : 0;
      let fnArgs = [];
      for (let i = 0; i < paramCount; i++) {
        fnArgs.push(AbstractValue.createAbstractArgument(realm, "__recursionPureProbe", realm.currentLocation, Value));
      }
      bypass = fn;
      let fnEffects = realm.evaluateForEffects(
        () => fnCall(realm.intrinsics.undefined, fnArgs),
        undefined,
        "residual recursion helper probe"
      );
      if (sawFatalDiagnostic) return `evaluating ${functionName(fn)} with abstract arguments fails`;
      rootEffects.push([fn, fnEffects]);
    }
  } catch (e) {
    if (isUnsoundResidualRecursionError(e)) throw e;
    if (!(e instanceof FatalError)) throw e;
    return `evaluating ${functionName(F)} with abstract arguments fails`;
  } finally {
    bypass = undefined;
    pureProbeDepth.set(realm, (pureProbeDepth.get(realm) || 1) - 1);
    pureProving.delete(F);
    for (let fn of leakedFunctions) pureProving.delete(fn);
    realm.errorHandler = savedErrorHandler;
    realm.suppressDiagnostics = savedSuppress;
  }

  for (let [probedFn, effects] of rootEffects) {
    let created: Set<ObjectValue> = new Set();
    let allEffects: Array<Effects> = [];
    let visited: Set<Effects | Completion> = new Set();
    let visitCompletion = (c: void | Completion) => {
      if (c === undefined || visited.has(c)) return;
      visited.add(c);
      if (c instanceof JoinedNormalAndAbruptCompletions) {
        if (c.savedEffects !== undefined) visitEffects(c.savedEffects);
        visitCompletion(c.composedWith);
      }
      if (c instanceof JoinedNormalAndAbruptCompletions || c instanceof JoinedAbruptCompletions) {
        visitCompletion(c.consequent);
        visitCompletion(c.alternate);
      }
    };
    let visitEffects = (e: Effects) => {
      if (visited.has(e)) return;
      visited.add(e);
      allEffects.push(e);
      for (let obj of e.createdObjects) created.add(obj);
      visitCompletion(e.result);
    };
    visitEffects(effects);

    for (let e of allEffects) {
      for (let [binding, previousEntry] of e.modifiedBindings) {
        if (binding.hasLeaked && previousEntry.hasLeaked) continue;
        if (binding.environment.id >= firstEnvId) continue;
        return `${functionName(probedFn)} modifies the variable ${binding.name}`;
      }
      for (let [propertyBinding] of e.modifiedProperties) {
        let obj = propertyBinding.object;
        if (created.has(obj)) continue;
        if (!obj.mightNotBeLeakedObject()) continue;
        if (obj.intrinsicName === "__checkedBindings") continue;
        return `${functionName(probedFn)} modifies an object that was not leaked or created by the call`;
      }
    }
  }
  return undefined;
}

// Global code: Prepack continues with the result of the residual call, so it needs its type, and it must
// know that the call does not modify state that Prepack tracks. Both follow by induction on the runtime
// recursion depth from a probe: evaluate the body once with fresh abstract arguments of the same types,
// assuming that every nested call of F with arguments of these types returns a value of type T, and check
// that the result has type T, that there is no possible throw, and that only objects created by the call
// are modified. The path conditions at the call point hold during the whole runtime call.
function proveResultType(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>,
  snapshot: Snapshot
): ProveTypeResult {
  let signature = argsList.map(arg => arg.getType().name).join(",");
  let inProgress = hypotheses.get(F);
  if (inProgress === undefined) hypotheses.set(F, (inProgress = new Map()));
  let assumed = inProgress.get(signature);
  if (assumed !== undefined) return { ok: true, resultType: assumed };
  let provenAtPath = proven.get(realm.pathConditions);
  if (provenAtPath === undefined) proven.set(realm.pathConditions, (provenAtPath = new Map()));
  let key = functionKey(F) + "(" + signature + ")";
  let known = provenAtPath.get(key);
  if (known !== undefined) return { ok: true, resultType: known };

  let call = F.$Call;
  invariant(call !== undefined);
  let preexistingBindings = new Set(snapshot.bindings.map(([binding]) => binding));
  let failure = "the probe evaluation failed";
  probeDepth.set(realm, (probeDepth.get(realm) || 0) + 1);
  try {
    for (let candidate of [NumberValue, StringValue, BooleanValue, PrimitiveValue]) {
      inProgress.set(signature, candidate);
      let savedErrorHandler = realm.errorHandler;
      realm.errorHandler = d => (d.severity === "Information" || d.severity === "Warning" ? "Recover" : "Fail");
      let effects;
      try {
        let probeArgs = argsList.map(arg => {
          let argType = arg.getType();
          let probeType =
            argType === NullValue || argType === UndefinedValue || argType === EmptyValue ? Value : argType;
          return AbstractValue.createAbstractArgument(realm, "__recursionProbe", realm.currentLocation, probeType);
        });
        bypass = F;
        effects = realm.evaluateForEffects(() => call(thisArgument, probeArgs), undefined, "residual recursion probe");
      } catch (e) {
        if (!(e instanceof FatalError)) throw e;
        failure = `evaluating ${functionName(F)} with abstract arguments fails`;
        continue;
      } finally {
        bypass = undefined;
        inProgress.delete(signature);
        realm.errorHandler = savedErrorHandler;
      }
      let completion = effects.result;
      if (!(completion instanceof SimpleNormalCompletion))
        return { ok: false, reason: `${functionName(F)} might throw` };
      for (let [binding] of effects.modifiedBindings) {
        if (preexistingBindings.has(binding) || binding.environment instanceof GlobalEnvironmentRecord)
          return { ok: false, reason: `${functionName(F)} modifies the variable ${binding.name}` };
      }
      for (let [propertyBinding] of effects.modifiedProperties) {
        if (propertyBinding.object.intrinsicName === "__checkedBindings") continue;
        if (!effects.createdObjects.has(propertyBinding.object))
          return { ok: false, reason: `${functionName(F)} modifies an object that it did not create` };
      }
      let resultType = completion.value.getType();
      if (Value.isTypeCompatibleWith(resultType, candidate)) {
        provenAtPath.set(key, candidate);
        return { ok: true, resultType: candidate };
      }
      failure = `the result type of ${functionName(F)} is not a known primitive type`;
    }
    return { ok: false, reason: failure };
  } finally {
    probeDepth.set(realm, (probeDepth.get(realm) || 1) - 1);
  }
}

function isInsideProbe(realm: Realm): boolean {
  return (probeDepth.get(realm) || 0) > 0;
}

let functionKeys: WeakMap<ECMAScriptSourceFunctionValue, string> = new WeakMap();
let nextFunctionKey = 0;
function functionKey(F: ECMAScriptSourceFunctionValue): string {
  let key = functionKeys.get(F);
  if (key === undefined) functionKeys.set(F, (key = "f" + nextFunctionKey++));
  return key;
}

// Global code only: a residual call reads the final values of the bindings and properties it can reach
// (the serializer emits final values), so they must not have changed after the call point.
export function checkResidualRecursionSnapshots(realm: Realm): void {
  let snapshots = pendingSnapshots.get(realm);
  if (snapshots === undefined) return;
  pendingSnapshots.delete(realm);
  for (let snapshot of snapshots) {
    if (snapshot.active.value === undefined || !snapshot.active.value.mightBeTrue()) continue;
    let changed;
    for (let [binding, value] of snapshot.bindings) {
      if (binding.value !== value) changed = `binding ${binding.name}`;
    }
    for (let [object, name, descriptor] of snapshot.properties) {
      let propertyBinding = object.properties.get(name);
      if ((propertyBinding === undefined ? undefined : propertyBinding.descriptor) !== descriptor)
        changed = `property ${name}`;
    }
    for (let [object, count] of snapshot.propertyCounts) {
      if (object.properties.size !== count) changed = "the properties of an object";
    }
    for (let [object, prototype] of snapshot.prototypes) {
      if (object.$Prototype !== prototype) changed = "the prototype of an object";
    }
    if (changed === undefined) continue;
    let diagnostic = new CompilerDiagnostic(
      `residual recursive call of ${snapshot.functionName} reads ${changed}, which is modified after the call`,
      snapshot.location,
      "PP0050",
      "FatalError"
    );
    realm.handleError(diagnostic);
    throw new FatalError();
  }
}

function createActiveMarker(realm: Realm): Binding {
  return {
    value: realm.intrinsics.false,
    initialized: true,
    mutable: true,
    deletable: false,
    strict: false,
    environment: new DeclarativeEnvironmentRecord(realm),
    name: "__residualRecursionSnapshot",
    isGlobal: false,
    mightHaveBeenCaptured: false,
    hasLeaked: false,
  };
}

// Collects the functions that a residual call of F may run (F and the functions it reaches through
// free variables) and checks that the call can be emitted soundly.
function checkCluster(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>,
  pure: boolean
): ClusterCheckResult {
  let snapshot: Snapshot = {
    active: createActiveMarker(realm),
    location: realm.currentLocation,
    functionName: functionName(F),
    bindings: [],
    properties: [],
    propertyCounts: [],
    prototypes: [],
  };
  if (!pure) {
    if ((tryDepths.get(realm) || 0) > 0)
      return { ok: false, reason: "the call is inside a try statement in global code" };
    if (!(thisArgument instanceof UndefinedValue) && F.$ThisMode !== "lexical")
      return { ok: false, reason: "the call has a this argument in global code" };
    for (let arg of argsList) {
      if (arg instanceof ObjectValue || (arg instanceof AbstractValue && arg.mightBeObject()))
        return { ok: false, reason: "an argument might be an object in global code" };
    }
  }
  let tracked = realm.createdObjectsTrackedForLeaks;
  let cluster = [F];
  let leakedFunctions: Array<ECMAScriptSourceFunctionValue> = [];
  let visited = new Set(cluster);
  let visitedObjects = new Set();
  for (let i = 0; i < cluster.length; i++) {
    let fn = cluster[i];
    let info = getStaticInfo(fn);
    let unsupported = info.unsupported;
    if (unsupported !== undefined) return { ok: false, reason: `${functionName(fn)} ${unsupported}` };
    if (!pure && info.hasMemberWrite)
      return { ok: false, reason: `${functionName(fn)} writes object properties in global code` };
    for (let name of new Set([...info.freeReads, ...info.freeWrites])) {
      let resolved = resolveFreeName(realm, fn, name, tracked, !pure);
      if (typeof resolved === "string") return { ok: false, reason: `${functionName(fn)} ${resolved}` };
      // Bindings created in this pure scope are leaked (havoced) before the call, but any local helper
      // functions they currently hold are still part of the cluster that the residual call may invoke.
      if (resolved.leakable) {
        let localValue = resolved.binding === undefined ? undefined : resolved.binding.value;
        if (localValue instanceof ECMAScriptSourceFunctionValue && !localValue.isIntrinsic()) {
          if (localValue.$FunctionKind !== "normal")
            return {
              ok: false,
              reason: `${functionName(fn)} reads the variable ${name}, which is not a normal function`,
            };
          if (!visited.has(localValue)) {
            visited.add(localValue);
            cluster.push(localValue);
            leakedFunctions.push(localValue);
          }
        }
        continue;
      }
      if (info.freeWrites.has(name))
        return { ok: false, reason: `${functionName(fn)} writes the non-local variable ${name}` };
      if (info.memberWriteBases.has(name))
        return { ok: false, reason: `${functionName(fn)} writes properties of the non-local variable ${name}` };
      let readValue: Value;
      if (resolved.binding !== undefined) {
        let bindingValue = resolved.binding.value;
        if (bindingValue === undefined || resolved.binding.initialized === false)
          return { ok: false, reason: `${functionName(fn)} reads the uninitialized variable ${name}` };
        snapshot.bindings.push([resolved.binding, bindingValue]);
        readValue = bindingValue;
      } else {
        let globalObject = resolved.globalObject;
        invariant(globalObject !== undefined);
        let propertyBinding = globalObject.properties.get(name);
        let descriptor = propertyBinding === undefined ? undefined : propertyBinding.descriptor;
        if (!(descriptor instanceof PropertyDescriptor))
          return {
            ok: false,
            reason: `${functionName(fn)} reads the global ${name}, which is not a known data property`,
          };
        let descriptorValue = descriptor.value;
        if (!(descriptorValue instanceof Value))
          return {
            ok: false,
            reason: `${functionName(fn)} reads the global ${name}, which is not a known data property`,
          };
        snapshot.properties.push([globalObject, name, descriptor]);
        readValue = descriptorValue;
      }
      let failure = checkReadValue(realm, readValue, name, pure, cluster, visited, visitedObjects, snapshot);
      if (failure !== undefined) return { ok: false, reason: `${functionName(fn)} ${failure}` };
    }
  }
  return { ok: true, snapshot, leakedFunctions };
}

function checkReadValue(
  realm: Realm,
  value: Value,
  name: string,
  pure: boolean,
  cluster: Array<ECMAScriptSourceFunctionValue>,
  visited: Set<ECMAScriptSourceFunctionValue>,
  visitedObjects: Set<ObjectValue>,
  snapshot: Snapshot
): void | string {
  if (value instanceof PrimitiveValue) return undefined;
  if (value instanceof AbstractValue) {
    if (pure || !value.mightBeObject()) return undefined;
    return `reads the variable ${name}, which might be an abstract object`;
  }
  if (!(value instanceof ObjectValue)) return `reads the variable ${name}, which has an unsupported value`;
  if (value instanceof ECMAScriptSourceFunctionValue && !value.isIntrinsic()) {
    if (value.$FunctionKind !== "normal") return `reads the variable ${name}, which is not a normal function`;
    if (!visited.has(value)) {
      visited.add(value);
      cluster.push(value);
      snapshotProperties(value, snapshot);
    }
    return undefined;
  }
  if (pure) return undefined;
  // Global code: the residual call sees the final state of what it reads, so snapshot everything it can reach.
  if (visitedObjects.has(value)) return undefined;
  visitedObjects.add(value);
  if (visitedObjects.size > MAX_SNAPSHOT_OBJECTS) return `reads too many objects through ${name}`;
  snapshotProperties(value, snapshot);
  // Intrinsics are assumed to keep their (possibly modified) state; only their own properties are checked.
  if (value.isIntrinsic()) return undefined;
  let kind = value.getKind();
  if ((kind !== "Object" && kind !== "Array") || value.isPartialObject() || value.unknownProperty !== undefined)
    return `reads the variable ${name}, which holds an object that cannot be tracked`;
  if (value.symbols.size > 0) return `reads the variable ${name}, which holds an object with symbol properties`;
  snapshot.prototypes.push([value, value.$Prototype]);
  let reachable = [value.$Prototype];
  for (let propertyBinding of value.properties.values()) {
    let descriptor = propertyBinding.descriptor;
    if (descriptor === undefined) continue;
    if (!(descriptor instanceof PropertyDescriptor) || descriptor.value === undefined)
      return `reads the variable ${name}, which holds an object with accessors`;
    let propVal = descriptor.value;
    invariant(propVal instanceof Value);
    reachable.push(propVal);
  }
  for (let reachableValue of reachable) {
    let failure = checkReadValue(realm, reachableValue, name, pure, cluster, visited, visitedObjects, snapshot);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function snapshotProperties(object: ObjectValue, snapshot: Snapshot): void {
  snapshot.propertyCounts.push([object, object.properties.size]);
  for (let [name, propertyBinding] of object.properties) {
    snapshot.properties.push([object, name, propertyBinding.descriptor]);
  }
}

// Resolves a free variable of fn the way the residual function will see it. A binding is leakable if
// Leak.value(fn) would havoc it, i.e. it lives in an environment created in the current pure scope and
// no enclosing function along the chain is frozen or outside the pure scope.
function resolveFreeName(
  realm: Realm,
  fn: ECMAScriptSourceFunctionValue,
  name: string,
  tracked: void | Set<ObjectValue>,
  globalCode: boolean
): string | { binding?: Binding, globalObject?: ObjectValue, leakable: boolean } {
  let leakable = tracked !== undefined && tracked.has(fn) && !TestIntegrityLevel(realm, fn, "frozen");
  let environment = fn.$Environment;
  while (environment) {
    let record = environment.environmentRecord;
    if (record instanceof ObjectEnvironmentRecord) return `uses a with statement environment`;
    if (record instanceof DeclarativeEnvironmentRecord) {
      let binding = record.bindings[name];
      if (binding !== undefined) return { binding, leakable };
      if (record instanceof FunctionEnvironmentRecord) {
        let owner = record.$FunctionObject;
        if (tracked === undefined || !tracked.has(owner) || TestIntegrityLevel(realm, owner, "frozen")) {
          leakable = false;
        }
      }
    } else if (record instanceof GlobalEnvironmentRecord) {
      let declarative = record.$DeclarativeRecord;
      invariant(declarative instanceof DeclarativeEnvironmentRecord);
      let binding = declarative.bindings[name];
      if (binding !== undefined) {
        // The serializer initializes global lexical bindings at the end of the global code.
        if (globalCode) return `reads the global lexical variable ${name}`;
        return { binding, leakable: false };
      }
      let globalObject = record.$ObjectRecord.object;
      if (!(globalObject instanceof ObjectValue)) return `uses an abstract global object`;
      if (!globalObject.properties.has(name)) return `reads the unknown global ${name}`;
      return { globalObject, leakable: false };
    }
    environment = environment.parent;
  }
  return `reads the unresolvable variable ${name}`;
}

function functionName(F: ECMAScriptSourceFunctionValue): string {
  let name = F.getName();
  return name === undefined || name === "" ? "an anonymous function" : name;
}

function getStaticInfo(F: ECMAScriptSourceFunctionValue): StaticInfo {
  let code = F.$ECMAScriptCode;
  invariant(code != null);
  let cached = staticInfoCache.get(code);
  if (cached !== undefined) return cached;
  let info: StaticInfo = {
    freeReads: new Set(),
    freeWrites: new Set(),
    memberWriteBases: new Set(),
    hasMemberWrite: false,
    unsupported: undefined,
  };
  let formalParameters = F.$FormalParameters;
  invariant(formalParameters != null);
  traverse(
    t.file(t.program([t.expressionStatement(t.functionExpression(null, formalParameters, code))])),
    StaticInfoVisitor,
    null,
    info
  );
  traverse.cache.clear();
  staticInfoCache.set(code, info);
  return info;
}

function isFree(path: BabelTraversePath, name: string): boolean {
  return !path.scope.hasBinding(name, /*noGlobals*/ true);
}

function findRootIdentifier(node: BabelNodeExpression | BabelNodeLVal | BabelNodeVariableDeclaration): void | string {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return findRootIdentifier(node.object);
  return undefined;
}

function recordMemberWrite(
  path: BabelTraversePath,
  target: BabelNodeExpression | BabelNodeLVal | BabelNodeVariableDeclaration,
  info: StaticInfo
): void {
  if (target.type !== "MemberExpression") return;
  info.hasMemberWrite = true;
  let rootName = findRootIdentifier(target.object);
  if (rootName !== undefined && isFree(path, rootName)) info.memberWriteBases.add(rootName);
}

let StaticInfoVisitor = {
  ReferencedIdentifier(path: BabelTraversePath, info: StaticInfo): void {
    let parent = path.parent;
    if (t.isLabeledStatement(parent) || t.isBreakStatement(parent) || t.isContinueStatement(parent)) return;
    let name = path.node.name;
    if (name === "arguments" || name === "undefined") return;
    if (isFree(path, name)) info.freeReads.add(name);
  },
  AssignmentExpression(path: BabelTraversePath, info: StaticInfo): void {
    for (let name in path.getBindingIdentifiers()) {
      if (isFree(path, name)) info.freeWrites.add(name);
    }
    recordMemberWrite(path, path.node.left, info);
  },
  UpdateExpression(path: BabelTraversePath, info: StaticInfo): void {
    let argument = path.node.argument;
    if (argument.type === "Identifier" && isFree(path, argument.name)) info.freeWrites.add(argument.name);
    recordMemberWrite(path, argument, info);
  },
  UnaryExpression(path: BabelTraversePath, info: StaticInfo): void {
    if (path.node.operator === "delete") recordMemberWrite(path, path.node.argument, info);
  },
  ForXStatement(path: BabelTraversePath, info: StaticInfo): void {
    let left = path.node.left;
    if (left.type === "Identifier" && isFree(path, left.name)) info.freeWrites.add(left.name);
    recordMemberWrite(path, left, info);
  },
  WithStatement(path: BabelTraversePath, info: StaticInfo): void {
    info.unsupported = "contains a with statement";
  },
  CallExpression(path: BabelTraversePath, info: StaticInfo): void {
    let callee = path.node.callee;
    if (callee.type === "Identifier" && callee.name === "eval" && isFree(path, "eval")) info.unsupported = "calls eval";
  },
};
