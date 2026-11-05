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
import type { Binding } from "../environment.js";
import type { PathConditions } from "../types.js";
import type { BabelNode, BabelNodeSourceLocation } from "@babel/types";
import {
  DeclarativeEnvironmentRecord,
  FunctionEnvironmentRecord,
  GlobalEnvironmentRecord,
  ObjectEnvironmentRecord,
} from "../environment.js";
import {
  AbstractValue,
  BooleanValue,
  ECMAScriptSourceFunctionValue,
  NumberValue,
  StringValue,
  FunctionValue,
  ObjectValue,
  PrimitiveValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { PropertyDescriptor } from "../descriptors.js";
import { SimpleNormalCompletion } from "../completions.js";
import { Leak } from "../singletons.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { createOperationDescriptor } from "../utils/generator.js";
import invariant from "../invariant.js";
import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { BabelTraversePath } from "@babel/traverse";

// While the arguments of a re-entered call are all concrete, keep unrolling up to this many
// nested activations of the same function before residualizing.
const CONCRETE_UNROLL_LIMIT = 8;
// Global code: the maximum number of objects whose state a residual call may read.
const MAX_SNAPSHOT_OBJECTS = 200;

type Activation = { pathConditions: PathConditions };

type StaticInfo = {
  freeReads: Set<string>,
  freeWrites: Set<string>,
  memberWriteBases: Set<string>, // free identifiers that are the base of a property write or delete
  hasMemberWrite: boolean,
  unsupported: void | string,
};

type Snapshot = {
  location: ?BabelNodeSourceLocation,
  functionName: string,
  bindings: Array<[Binding, Value]>,
  properties: Array<[ObjectValue, string, mixed]>,
  propertyCounts: Array<[ObjectValue, number]>,
  prototypes: Array<[ObjectValue, Value]>,
};

let activations: WeakMap<ECMAScriptSourceFunctionValue, Array<Activation>> = new WeakMap();
let staticInfoCache: WeakMap<{}, StaticInfo> = new WeakMap();
let pendingSnapshots: WeakMap<Realm, Array<Snapshot>> = new WeakMap();
let tryDepths: WeakMap<Realm, number> = new WeakMap();
// Result types assumed for nested calls while a probe of the function with these argument types runs.
let hypotheses: WeakMap<ECMAScriptSourceFunctionValue, Map<string, typeof Value>> = new WeakMap();
// Result types proven by probes, per path condition.
let proven: WeakMap<PathConditions, Map<string, typeof Value>> = new WeakMap();
let bypass: void | ECMAScriptSourceFunctionValue;
let residualizationCounts: WeakMap<ECMAScriptSourceFunctionValue, number> = new WeakMap();

// Whether F can reach itself through the functions that its free variables currently refer to.
function isPossiblyRecursive(realm: Realm, F: ECMAScriptSourceFunctionValue): boolean {
  let worklist = [F];
  let visited = new Set(worklist);
  while (worklist.length > 0) {
    let fn = worklist.pop();
    let info = getStaticInfo(fn);
    for (let name of info.freeReads) {
      let resolved = resolveFreeName(realm, fn, name, undefined, false);
      if (typeof resolved === "string") continue;
      let value;
      if (resolved.binding !== undefined) value = resolved.binding.value;
      else if (resolved.globalObject !== undefined) {
        let propertyBinding = resolved.globalObject.properties.get(name);
        let descriptor = propertyBinding === undefined ? undefined : propertyBinding.descriptor;
        if (descriptor instanceof PropertyDescriptor) value = descriptor.value;
      }
      if (value === F) return true;
      if (value instanceof ECMAScriptSourceFunctionValue && !value.isIntrinsic() && !visited.has(value)) {
        visited.add(value);
        worklist.push(value);
      }
    }
  }
  return false;
}

export function enterTryBlock(realm: Realm): void {
  tryDepths.set(realm, (tryDepths.get(realm) || 0) + 1);
}

export function exitTryBlock(realm: Realm): void {
  tryDepths.set(realm, (tryDepths.get(realm) || 1) - 1);
}

// Runs a call of F, keeping track of active calls so that re-entries can be detected.
export function withActivation<T>(realm: Realm, F: FunctionValue, f: () => T): T {
  if (!(F instanceof ECMAScriptSourceFunctionValue) || !realm.useAbstractInterpretation) return f();
  let stack = activations.get(F);
  if (stack === undefined) activations.set(F, (stack = []));
  stack.push({ pathConditions: realm.pathConditions });
  try {
    return f();
  } finally {
    stack.pop();
  }
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
    // The top-level call of a probe evaluation.
    bypass = undefined;
    return undefined;
  }
  let stack = activations.get(F);
  if (stack === undefined || stack.length === 0) return speculateOutermostCall(realm, F, thisArgument, argsList);
  // Recursion is driven by abstract values if the re-entry happens on a path that is guarded by
  // conditions that were assumed after the enclosing call of F started.
  if (realm.pathConditions === stack[stack.length - 1].pathConditions) return undefined;
  let abstractArgs = argsList.some(arg => arg instanceof AbstractValue);
  if (!abstractArgs && stack.length < CONCRETE_UNROLL_LIMIT) return undefined;

  return emitResidualCall(realm, F, thisArgument, argsList);
}

// The outermost call of a recursive function with abstract arguments is evaluated speculatively: if its
// recursion turns out to be driven by abstract values, the call itself becomes a residual call too, rather
// than an inlined copy of the function body around nested residual calls.
function speculateOutermostCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): void | Value {
  if (!argsList.some(arg => arg instanceof AbstractValue) || !isPossiblyRecursive(realm, F)) return undefined;
  let before = residualizationCounts.get(F) || 0;
  bypass = F;
  let effects;
  try {
    effects = realm.evaluateForEffects(
      () => F.$Call(thisArgument, argsList),
      undefined,
      "speculative recursive call"
    );
  } finally {
    bypass = undefined;
  }
  if ((residualizationCounts.get(F) || 0) === before) {
    realm.applyEffects(effects);
    return realm.returnOrThrowCompletion(effects.result);
  }
  return emitResidualCall(realm, F, thisArgument, argsList);
}

function emitResidualCall(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>
): Value {
  residualizationCounts.set(F, (residualizationCounts.get(F) || 0) + 1);
  let pure = realm.isInPureScope();
  let result = checkCluster(realm, F, thisArgument, argsList, pure);
  if (typeof result === "string") reportFailure(realm, F, result);

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
    return realm.evaluateWithPossibleThrowCompletion(
      () => AbstractValue.createTemporalFromBuildFunction(realm, Value, callArgs, descriptor),
      TypesDomain.topVal,
      ValuesDomain.topVal
    );
  }

  invariant(result !== undefined);
  let snapshot = result;
  let resultType = proveResultType(realm, F, thisArgument, argsList, snapshot);
  if (typeof resultType === "string") reportFailure(realm, F, resultType);
  let snapshots = pendingSnapshots.get(realm);
  if (snapshots === undefined) pendingSnapshots.set(realm, (snapshots = []));
  snapshots.push(snapshot);
  return AbstractValue.createTemporalFromBuildFunction(realm, resultType, callArgs, descriptor);
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
  throw new FatalError();
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
): string | typeof Value {
  let signature = argsList.map(arg => arg.getType().name).join(",");
  let inProgress = hypotheses.get(F);
  if (inProgress === undefined) hypotheses.set(F, (inProgress = new Map()));
  let assumed = inProgress.get(signature);
  if (assumed !== undefined) return assumed;
  let provenAtPath = proven.get(realm.pathConditions);
  if (provenAtPath === undefined) proven.set(realm.pathConditions, (provenAtPath = new Map()));
  let key = functionKey(F) + "(" + signature + ")";
  let known = provenAtPath.get(key);
  if (known !== undefined) return known;

  let preexistingBindings = new Set(snapshot.bindings.map(([binding]) => binding));
  let failure = "the probe evaluation failed";
  for (let candidate of [NumberValue, StringValue, BooleanValue, PrimitiveValue]) {
    inProgress.set(signature, candidate);
    let savedErrorHandler = realm.errorHandler;
    realm.errorHandler = d => (d.severity === "Information" || d.severity === "Warning" ? "Recover" : "Fail");
    let effects;
    try {
      let probeArgs = argsList.map(arg =>
        AbstractValue.createAbstractArgument(realm, "__recursionProbe", realm.currentLocation, arg.getType())
      );
      bypass = F;
      effects = realm.evaluateForEffects(
        () => F.$Call(thisArgument, probeArgs),
        undefined,
        "residual recursion probe"
      );
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
    if (!(completion instanceof SimpleNormalCompletion)) return `${functionName(F)} might throw`;
    for (let [binding] of effects.modifiedBindings) {
      if (preexistingBindings.has(binding) || binding.environment instanceof GlobalEnvironmentRecord)
        return `${functionName(F)} modifies the variable ${binding.name}`;
    }
    for (let [propertyBinding] of effects.modifiedProperties) {
      if (!effects.createdObjects.has(propertyBinding.object))
        return `${functionName(F)} modifies an object that it did not create`;
    }
    let resultType = completion.value.getType();
    if (Value.isTypeCompatibleWith(resultType, candidate)) {
      provenAtPath.set(key, candidate);
      return candidate;
    }
    failure = `the result type of ${functionName(F)} is not a known primitive type`;
  }
  return failure;
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

// Collects the functions that a residual call of F may run (F and the functions it reaches through
// free variables) and checks that the call can be emitted soundly. Returns a reason string on failure.
function checkCluster(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  thisArgument: Value,
  argsList: Array<Value>,
  pure: boolean
): string | void | Snapshot {
  let snapshot: Snapshot = {
    location: realm.currentLocation,
    functionName: functionName(F),
    bindings: [],
    properties: [],
    propertyCounts: [],
    prototypes: [],
  };
  if (!pure) {
    if ((tryDepths.get(realm) || 0) > 0) return "the call is inside a try statement in global code";
    if (!(thisArgument instanceof UndefinedValue) && F.$ThisMode !== "lexical")
      return "the call has a this argument in global code";
    for (let arg of argsList) {
      if (arg instanceof ObjectValue || (arg instanceof AbstractValue && arg.mightBeObject()))
        return "an argument might be an object in global code";
    }
  }
  let tracked = realm.createdObjectsTrackedForLeaks;
  let cluster = [F];
  let visited = new Set(cluster);
  let visitedObjects = new Set();
  for (let i = 0; i < cluster.length; i++) {
    let fn = cluster[i];
    let info = getStaticInfo(fn);
    if (info.unsupported !== undefined) return `${functionName(fn)} ${info.unsupported}`;
    if (!pure && info.hasMemberWrite) return `${functionName(fn)} writes object properties in global code`;
    for (let name of new Set([...info.freeReads, ...info.freeWrites])) {
      let resolved = resolveFreeName(realm, fn, name, tracked, !pure);
      if (typeof resolved === "string") return `${functionName(fn)} ${resolved}`;
      // Bindings created in this pure scope are leaked (havoced) before the call.
      if (resolved.leakable) continue;
      if (info.freeWrites.has(name)) return `${functionName(fn)} writes the non-local variable ${name}`;
      if (info.memberWriteBases.has(name))
        return `${functionName(fn)} writes properties of the non-local variable ${name}`;
      let value;
      if (resolved.binding !== undefined) {
        value = resolved.binding.value;
        if (value === undefined || resolved.binding.initialized === false)
          return `${functionName(fn)} reads the uninitialized variable ${name}`;
        snapshot.bindings.push([resolved.binding, value]);
      } else {
        let globalObject = resolved.globalObject;
        invariant(globalObject !== undefined);
        let propertyBinding = globalObject.properties.get(name);
        let descriptor = propertyBinding === undefined ? undefined : propertyBinding.descriptor;
        if (!(descriptor instanceof PropertyDescriptor) || !(descriptor.value instanceof Value))
          return `${functionName(fn)} reads the global ${name}, which is not a known data property`;
        snapshot.properties.push([globalObject, name, descriptor]);
        value = descriptor.value;
      }
      let failure = checkReadValue(realm, value, name, pure, cluster, visited, visitedObjects, snapshot);
      if (failure !== undefined) return `${functionName(fn)} ${failure}`;
    }
  }
  return pure ? undefined : snapshot;
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
    invariant(descriptor.value instanceof Value);
    reachable.push(descriptor.value);
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
// Leak.value(fn) would havoc it, i.e. it lives in an environment created in the current pure scope.
function resolveFreeName(
  realm: Realm,
  fn: ECMAScriptSourceFunctionValue,
  name: string,
  tracked: void | Set<ObjectValue>,
  globalCode: boolean
): string | { binding?: Binding, globalObject?: ObjectValue, leakable: boolean } {
  let leakable = tracked !== undefined && tracked.has(fn);
  let environment = fn.$Environment;
  while (environment) {
    let record = environment.environmentRecord;
    if (record instanceof ObjectEnvironmentRecord) return `uses a with statement environment`;
    if (record instanceof DeclarativeEnvironmentRecord) {
      let binding = record.bindings[name];
      if (binding !== undefined) return { binding, leakable };
      if (record instanceof FunctionEnvironmentRecord) {
        let owner = record.$FunctionObject;
        if (tracked === undefined || !tracked.has(owner)) leakable = false;
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

function recordMemberWrite(path: BabelTraversePath, target: BabelNode, info: StaticInfo): void {
  if (!t.isMemberExpression(target)) return;
  info.hasMemberWrite = true;
  let base = target;
  while (t.isMemberExpression(base)) base = base.object;
  if (t.isIdentifier(base) && isFree(path, base.name)) info.memberWriteBases.add(base.name);
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
    if (t.isIdentifier(argument) && isFree(path, argument.name)) info.freeWrites.add(argument.name);
    recordMemberWrite(path, argument, info);
  },
  UnaryExpression(path: BabelTraversePath, info: StaticInfo): void {
    if (path.node.operator === "delete") recordMemberWrite(path, path.node.argument, info);
  },
  ForXStatement(path: BabelTraversePath, info: StaticInfo): void {
    let left = path.node.left;
    if (t.isIdentifier(left) && isFree(path, left.name)) info.freeWrites.add(left.name);
    recordMemberWrite(path, left, info);
  },
  WithStatement(path: BabelTraversePath, info: StaticInfo): void {
    info.unsupported = "contains a with statement";
  },
  CallExpression(path: BabelTraversePath, info: StaticInfo): void {
    let callee = path.node.callee;
    if (t.isIdentifier(callee) && callee.name === "eval" && isFree(path, "eval"))
      info.unsupported = "calls eval";
  },
};
