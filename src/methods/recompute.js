/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { Effects, Realm } from "../realm.js";
import type { Binding } from "../environment.js";
import {
  DeclarativeEnvironmentRecord,
  EnvironmentRecord,
  FunctionEnvironmentRecord,
  GlobalEnvironmentRecord,
  type LexicalEnvironment,
  ObjectEnvironmentRecord,
} from "../environment.js";
import {
  AbstractValue,
  ArrayValue,
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
import { PropertyDescriptor } from "../descriptors.js";
import { SimpleNormalCompletion } from "../completions.js";
import { IsArray } from "./is.js";
import { TemporalOperationEntry } from "../utils/generator.js";
import invariant from "../invariant.js";
import * as t from "@babel/types";
import type { BabelNode, BabelNodeForStatement, BabelNodeStatement } from "@babel/types";
import traverseFast from "../utils/traverse-fast.js";

type ObjectSnapshot = {
  obj: ObjectValue,
  propCount: number,
  extensible: boolean,
  proto: Value,
  entries: Array<[string, mixed]>,
};

export type CallRecomputeRecipe = {|
  kind: "call",
  target: ObjectValue,
  callee: ECMAScriptSourceFunctionValue,
  createdObjects: Set<ObjectValue>,
  pureTemporals: Array<Value>,
  bindingSnapshots: Array<[Binding, void | Value, boolean]>, // [binding, valAtCall, allowTargetSelfInit]
  globalSnapshots: Array<[string, mixed, boolean]>, // [name, descStateAtCall, allowTargetSelfInit]
  readObjectSnapshots: Array<ObjectSnapshot>,
  outputSnapshots: Array<ObjectSnapshot>,
|};

export type LoopRecomputeRecipe = {|
  kind: "loop",
  target: ObjectValue,
  targetIsArray: boolean,
  targetGlobalName: string,
  ast: BabelNodeForStatement,
  createdObjects: Set<ObjectValue>,
  mutatedGlobalsPre: Map<string, Value>,
  globalSnapshots: Array<[string, mixed]>,
  readGlobalObjects: Array<ObjectValue>,
  readObjectSnapshots: Array<ObjectSnapshot>,
  outputSnapshots: Array<ObjectSnapshot>,
|};

export type RecomputeRecipe = CallRecomputeRecipe | LoopRecomputeRecipe;

const MAX_SNAPSHOT_OBJECTS = 1200;

let callRecipesByRealm: WeakMap<Realm, Map<ObjectValue, CallRecomputeRecipe>> = new WeakMap();
let loopRecipesByRealm: WeakMap<Realm, Map<ObjectValue, LoopRecomputeRecipe>> = new WeakMap();
let activeCallDepth: WeakMap<Realm, number> = new WeakMap();
let staticCallInfoCache: WeakMap<BabelNode, { eligible: boolean, names: Set<string> }> = new WeakMap();

function getCallMap(realm: Realm): Map<ObjectValue, CallRecomputeRecipe> {
  let m = callRecipesByRealm.get(realm);
  if (m === undefined) callRecipesByRealm.set(realm, (m = new Map()));
  return m;
}

function getLoopMap(realm: Realm): Map<ObjectValue, LoopRecomputeRecipe> {
  let m = loopRecipesByRealm.get(realm);
  if (m === undefined) loopRecipesByRealm.set(realm, (m = new Map()));
  return m;
}

function descriptorToken(desc: mixed): mixed {
  if (desc === undefined) return undefined;
  if (desc instanceof PropertyDescriptor) {
    if (desc.get !== undefined || desc.set !== undefined) return desc;
    return desc.value;
  }
  return desc;
}

function isSameDescriptor(a: mixed, b: mixed): boolean {
  if (a === b) return true;
  if (a instanceof PropertyDescriptor && b instanceof PropertyDescriptor) {
    if (
      a.writable !== b.writable ||
      a.enumerable !== b.enumerable ||
      a.configurable !== b.configurable ||
      a.get !== b.get ||
      a.set !== b.set
    ) {
      return false;
    }
    if (a.value === b.value) return true;
    if (a.value instanceof NumberValue && b.value instanceof NumberValue) {
      return Object.is(a.value.value, b.value.value);
    }
    if (a.value instanceof StringValue && b.value instanceof StringValue) {
      return a.value.value === b.value.value;
    }
    if (a.value instanceof BooleanValue && b.value instanceof BooleanValue) {
      return a.value.value === b.value.value;
    }
  }
  return false;
}

function takeObjectSnapshot(obj: ObjectValue): ObjectSnapshot {
  let entries = [];
  let count = 0;
  for (let [k, pb] of obj.properties) {
    count++;
    if (entries.length < 64) {
      entries.push([k, descriptorToken(pb === undefined ? undefined : pb.descriptor)]);
    }
  }
  let ext = obj.$Extensible instanceof BooleanValue ? obj.$Extensible.value : false;
  return {
    obj,
    propCount: count,
    extensible: ext,
    proto: obj.$Prototype,
    entries,
  };
}

function verifyObjectSnapshot(snap: ObjectSnapshot): boolean {
  let obj = snap.obj;
  let ext = obj.$Extensible instanceof BooleanValue ? obj.$Extensible.value : false;
  if (ext !== snap.extensible || obj.$Prototype !== snap.proto) return false;
  if (obj.properties.size !== snap.propCount) return false;
  for (let [k, expected] of snap.entries) {
    let pb = obj.properties.get(k);
    let actual = descriptorToken(pb === undefined ? undefined : pb.descriptor);
    if (actual !== expected) return false;
  }
  return true;
}

function hasTopLevelValueReturn(code: BabelNode): boolean {
  if (code.type !== "BlockStatement") return true; // concise arrow body
  let found = false;
  const scan = (stmts: Array<BabelNodeStatement>): void => {
    for (let s of stmts) {
      if (found) return;
      switch (s.type) {
        case "ReturnStatement":
          if (s.argument != null) found = true;
          break;
        case "BlockStatement":
          scan(s.body);
          break;
        case "IfStatement":
          if (s.consequent) scan(s.consequent.type === "BlockStatement" ? s.consequent.body : [s.consequent]);
          if (s.alternate) scan(s.alternate.type === "BlockStatement" ? s.alternate.body : [s.alternate]);
          break;
        case "TryStatement":
          if (s.block) scan(s.block.body);
          if (s.handler && s.handler.body) scan(s.handler.body.body);
          if (s.finalizer) scan(s.finalizer.body);
          break;
        case "SwitchStatement":
          for (let c of s.cases) scan(c.consequent);
          break;
        default:
          break;
      }
    }
  };
  scan(code.body);
  return found;
}

function collectFreeIdentifiers(rootNode: BabelNode, extraBound?: Set<string>): { names: Set<string>, hasUnsupported: boolean } {
  let names: Set<string> = new Set();
  let hasUnsupported = false;

  const walk = (node: ?BabelNode, bound: Set<string>): void => {
    if (!node || typeof node !== "object" || hasUnsupported) return;
    switch (node.type) {
      case "WithStatement":
        hasUnsupported = true;
        return;
      case "Identifier": {
        let name = node.name;
        if (name === "eval" || name === "require") {
          hasUnsupported = true;
          return;
        }
        if (!bound.has(name) && name !== "undefined" && name !== "arguments") {
          names.add(name);
        }
        return;
      }
      case "MemberExpression":
        walk(node.object, bound);
        if (node.computed) walk(node.property, bound);
        return;
      case "ObjectProperty":
        if (node.computed) walk(node.key, bound);
        walk(node.value, bound);
        return;
      case "FunctionExpression":
      case "FunctionDeclaration":
      case "ArrowFunctionExpression": {
        let nextBound = new Set(bound);
        if (node.id && node.id.type === "Identifier") nextBound.add(node.id.name);
        for (let p of node.params) addPatternNames(p, nextBound);
        collectHoistedDecls(node.body, nextBound, true);
        walk(node.body, nextBound);
        return;
      }
      case "BlockStatement": {
        let nextBound = new Set(bound);
        collectHoistedDecls(node, nextBound, false);
        for (let s of node.body) walk(s, nextBound);
        return;
      }
      case "ForStatement": {
        let nextBound = new Set(bound);
        if (node.init && node.init.type === "VariableDeclaration" && node.init.kind !== "var") {
          for (let d of node.init.declarations) addPatternNames(d.id, nextBound);
        }
        if (node.init) walk(node.init, nextBound);
        if (node.test) walk(node.test, nextBound);
        if (node.update) walk(node.update, nextBound);
        walk(node.body, nextBound);
        return;
      }
      case "CatchClause": {
        let nextBound = new Set(bound);
        if (node.param) addPatternNames(node.param, nextBound);
        walk(node.body, nextBound);
        return;
      }
      case "VariableDeclarator":
        if (node.init) walk(node.init, bound);
        return;
      case "LabeledStatement":
        walk(node.body, bound);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      default: {
        for (let key in node) {
          if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments")
            continue;
          let child = (node: any)[key];
          if (Array.isArray(child)) {
            for (let elem of child) {
              if (elem && typeof elem.type === "string") walk(elem, bound);
            }
          } else if (child && typeof child.type === "string") {
            walk(child, bound);
          }
        }
      }
    }
  };

  let initialBound = new Set(extraBound || []);
  if (rootNode.type === "BlockStatement") {
    collectHoistedDecls(rootNode, initialBound, true);
  }
  walk(rootNode, initialBound);
  return { names, hasUnsupported };
}

function addPatternNames(pat: ?BabelNode, out: Set<string>): void {
  if (!pat) return;
  if (pat.type === "Identifier") {
    out.add(pat.name);
  } else if (pat.type === "AssignmentPattern") {
    addPatternNames(pat.left, out);
  } else if (pat.type === "RestElement") {
    addPatternNames(pat.argument, out);
  } else if (pat.type === "ArrayPattern") {
    for (let el of pat.elements) if (el) addPatternNames(el, out);
  } else if (pat.type === "ObjectPattern") {
    for (let prop of pat.properties) {
      if (prop.type === "RestElement") addPatternNames(prop.argument, out);
      else if (prop.value) addPatternNames(prop.value, out);
    }
  }
}

function collectHoistedDecls(node: ?BabelNode, out: Set<string>, includeVars: boolean): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "BlockStatement") {
    for (let s of node.body) {
      if (s.type === "FunctionDeclaration" && s.id) out.add(s.id.name);
      else if (s.type === "VariableDeclaration" && ( s.kind !== "var" || includeVars)) {
        for (let d of s.declarations) addPatternNames(d.id, out);
      } else if (includeVars) {
        collectVarsOnly(s, out);
      }
    }
  } else if (includeVars) {
    collectVarsOnly(node, out);
  }
}

function collectVarsOnly(node: ?BabelNode, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return;
  }
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (let d of node.declarations) addPatternNames(d.id, out);
    return;
  }
  for (let key in node) {
    if (key === "loc") continue;
    let child = (node: any)[key];
    if (Array.isArray(child)) {
      for (let el of child) if (el && typeof el.type === "string") collectVarsOnly(el, out);
    } else if (child && typeof child.type === "string") {
      collectVarsOnly(child, out);
    }
  }
}

function estimateCreatedGraphCost(
  root: ObjectValue,
  createdObjects: Set<ObjectValue>,
  callee: ?ECMAScriptSourceFunctionValue,
  minEnvId: number
): { bytes: number, retainsCallee: boolean, outputSnapshots: Array<ObjectSnapshot> } {
  let visitedObjs: Set<ObjectValue> = new Set([root]);
  let visitedEnvs: Set<DeclarativeEnvironmentRecord> = new Set();
  let seenFuncBodies: Set<BabelNode> = new Set();
  let worklist: Array<ObjectValue> = [root];
  let bytes = 0;
  let retainsCallee = false;
  let outputSnapshots: Array<ObjectSnapshot> = [];

  const enqueueVal = (v: void | Value): void => {
    if (v === undefined) return;
    if (v === callee) {
      retainsCallee = true;
      return;
    }
    if (v instanceof StringValue) {
      bytes += v.value.length + 3;
    } else if (v instanceof NumberValue) {
      bytes += String(v.value).length + 1;
    } else if (v instanceof PrimitiveValue) {
      bytes += 5;
    } else if (v instanceof ObjectValue && createdObjects.has(v) && !visitedObjs.has(v)) {
      visitedObjs.add(v);
      worklist.push(v);
    }
  };

  while (worklist.length > 0) {
    let obj = worklist.pop();
    if (outputSnapshots.length < MAX_SNAPSHOT_OBJECTS) {
      outputSnapshots.push(takeObjectSnapshot(obj));
    }
    bytes += 4;
    if (obj instanceof ECMAScriptSourceFunctionValue) {
      let code = obj.$ECMAScriptCode;
      if (code && !seenFuncBodies.has(code)) {
        seenFuncBodies.add(code);
        bytes += code.end && code.start ? code.end - code.start : 60;
      } else {
        bytes += 18;
      }
      let lexEnv = obj.$Environment;
      while (lexEnv != null) {
        let rec = lexEnv.environmentRecord;
        if (rec instanceof DeclarativeEnvironmentRecord && rec.id >= minEnvId && !visitedEnvs.has(rec)) {
          visitedEnvs.add(rec);
          for (let bName in rec.bindings) {
            let b = rec.bindings[bName];
            if (b && b.value) enqueueVal(b.value);
          }
        }
        lexEnv = lexEnv.parent;
      }
    }
    for (let [k, pb] of obj.properties) {
      if (k !== "length" && k !== "prototype" && k !== "name" && k !== "arguments" && k !== "caller") {
        bytes += IsArray(obj.$Realm, obj) ? 1 : k.length + 3;
      }
      let desc = pb && pb.descriptor;
      if (desc instanceof PropertyDescriptor) {
        enqueueVal(desc.value);
        enqueueVal(desc.get);
        enqueueVal(desc.set);
      }
    }
    if (obj.$Prototype instanceof ObjectValue) {
      enqueueVal(obj.$Prototype);
    }
  }
  return { bytes, retainsCallee, outputSnapshots };
}

function resolveFreeSnapshots(
  realm: Realm,
  env: LexicalEnvironment,
  freeNames: Set<string>,
  selfFunction?: ECMAScriptSourceFunctionValue
): {
  ok: boolean,
  bindingSnapshots: Array<[Binding, void | Value, boolean]>,
  globalSnapshots: Array<[string, mixed, boolean]>,
  readObjectSnapshots: Array<ObjectSnapshot>,
} {
  let bindingSnapshots = [];
  let globalSnapshots = [];
  let readObjectSnapshots = [];
  let seenObjs = new Set();

  const snapObj = (v: mixed) => {
    if (
      v instanceof ObjectValue &&
      !v.isIntrinsic() &&
      !(v instanceof FunctionValue) &&
      !seenObjs.has(v) &&
      readObjectSnapshots.length < 100
    ) {
      seenObjs.add(v);
      readObjectSnapshots.push(takeObjectSnapshot(v));
    }
  };

  for (let name of freeNames) {
    let cur: ?LexicalEnvironment = env;
    let resolved = false;
    while (cur != null) {
      let rec = cur.environmentRecord;
      if (rec instanceof DeclarativeEnvironmentRecord) {
        let b = rec.bindings[name];
        if (b !== undefined) {
          if (selfFunction !== undefined && b.value === selfFunction) {
            resolved = true;
            break;
          }
          let val = b.initialized ? b.value : undefined;
          bindingSnapshots.push([b, val, val === undefined || val instanceof UndefinedValue]);
          snapObj(val);
          resolved = true;
          break;
        }
      } else if (rec instanceof GlobalEnvironmentRecord) {
        let decl = rec.$DeclarativeRecord.bindings[name];
        if (decl !== undefined) {
          // Global let/const bindings are emitted after mainBody, so avoid recomputing through them unless unchanged.
          return { ok: false, bindingSnapshots: [], globalSnapshots: [], readObjectSnapshots: [] };
        }
        let pb = realm.$GlobalObject.properties.get(name);
        let tok = descriptorToken(pb === undefined ? undefined : pb.descriptor);
        globalSnapshots.push([name, tok, tok === undefined || tok instanceof UndefinedValue]);
        snapObj(tok);
        resolved = true;
        break;
      } else if (rec instanceof ObjectEnvironmentRecord) {
        return { ok: false, bindingSnapshots: [], globalSnapshots: [], readObjectSnapshots: [] };
      }
      cur = cur.parent;
    }
    if (!resolved) {
      let pb = realm.$GlobalObject.properties.get(name);
      let tok = descriptorToken(pb === undefined ? undefined : pb.descriptor);
      globalSnapshots.push([name, tok, tok === undefined || tok instanceof UndefinedValue]);
      snapObj(tok);
    }
  }
  return { ok: true, bindingSnapshots, globalSnapshots, readObjectSnapshots };
}

export function evaluateCallWithRecomputeTracking(
  realm: Realm,
  F: FunctionValue,
  thisArgument: Value,
  argsList: Array<Value>,
  runCall: () => Value
): Value {
  if (
    !realm.useAbstractInterpretation ||
    realm.isInPureScope() ||
    realm.instantRender.enabled ||
    !realm.pathConditions.isEmpty() ||
    !(F instanceof ECMAScriptSourceFunctionValue) ||
    F.$FunctionKind !== "normal" ||
    argsList.length !== 0 ||
    !(thisArgument instanceof UndefinedValue || thisArgument === realm.$GlobalObject)
  ) {
    return runCall();
  }
  let depth = activeCallDepth.get(realm) || 0;
  if (depth >= 2) return runCall();
  let code = F.$ECMAScriptCode;
  if (!code) return runCall();
  let codeBytes = code.end && code.start ? code.end - code.start : 0;
  if (codeBytes < 24) return runCall();

  let staticInfo = staticCallInfoCache.get(code);
  if (staticInfo === undefined) {
    if (!hasTopLevelValueReturn(code)) {
      staticInfo = { eligible: false, names: new Set() };
    } else {
      let paramNames = new Set();
      for (let p of F.$FormalParameters) addPatternNames(p, paramNames);
      if (F.__originalName) paramNames.add(F.__originalName);
      let freeInfo = collectFreeIdentifiers(code, paramNames);
      staticInfo = { eligible: !freeInfo.hasUnsupported, names: freeInfo.names };
    }
    staticCallInfoCache.set(code, staticInfo);
  }
  if (!staticInfo.eligible) return runCall();

  let preFree = resolveFreeSnapshots(realm, F.$Environment, staticInfo.names, F);
  if (!preFree.ok) return runCall();

  let minEnvId = EnvironmentRecord.nextId;
  activeCallDepth.set(realm, depth + 1);
  let effects: Effects;
  try {
    effects = realm.evaluateForEffects(runCall, undefined, "evaluateCallWithRecomputeTracking");
  } finally {
    activeCallDepth.set(realm, depth);
  }

  realm.applyEffects(effects);
  let completion = effects.result;
  if (!(completion instanceof SimpleNormalCompletion) || !(completion.value instanceof ObjectValue)) {
    return realm.returnOrThrowCompletion(completion);
  }

  let retObj: ObjectValue = completion.value;
  let pureTemporals = [];
  let genPure = true;
  for (let entry of effects.generator._entries) {
    if (entry instanceof TemporalOperationEntry && entry.isPure === true && entry.declared !== undefined) {
      pureTemporals.push(entry.declared);
    } else {
      genPure = false;
      break;
    }
  }
  if (effects.createdObjects.has(retObj) && genPure) {
    let pure = true;
    for (let [pb, prevDesc] of effects.modifiedProperties.entries()) {
      if (effects.createdObjects.has(pb.object)) continue;
      if (ObjectValue.refuseSerializationOnPropertyBinding(pb)) continue;
      if (isSameDescriptor(pb.descriptor, prevDesc)) continue;
      pure = false;
      break;
    }
    if (pure) {
      for (let [b, prevBindingEntry] of effects.modifiedBindings.entries()) {
        if (b.environment.id >= minEnvId) continue;
        if (prevBindingEntry && prevBindingEntry.previousValue === b.value && !b.hasLeaked) continue;
        pure = false;
        break;
      }
    }
    if (pure && !(thisArgument === realm.$GlobalObject && staticInfo.names.has("this"))) {
      let cost = estimateCreatedGraphCost(retObj, effects.createdObjects, F, minEnvId);
      let profitable = cost.retainsCallee
        ? cost.bytes > 512
        : cost.bytes > Math.max(codeBytes * 2.2, codeBytes + 250);
      if (profitable) {
        getCallMap(realm).set(retObj, {
          kind: "call",
          target: retObj,
          callee: F,
          createdObjects: effects.createdObjects,
          pureTemporals,
          bindingSnapshots: preFree.bindingSnapshots,
          globalSnapshots: preFree.globalSnapshots,
          readObjectSnapshots: preFree.readObjectSnapshots,
          outputSnapshots: cost.outputSnapshots,
        });
      }
    }
  }

  return retObj;
}

export type PreLoopToken = {|
  ast: BabelNodeForStatement,
  target: ObjectValue,
  targetIsArray: boolean,
  targetGlobalName: string,
  mutatedGlobalsPre: Map<string, Value>,
  freeNames: Set<string>,
  minEnvId: number,
|};

function isEmptyContainerBeforeLoop(realm: Realm, obj: ObjectValue): void | { isArray: boolean } {
  if (!obj.mightNotBeLeakedObject() || obj.temporalAlias !== undefined) return undefined;
  for (let sb of obj.symbols.values()) {
    if (sb !== undefined && sb.descriptor !== undefined) return undefined;
  }
  let ext = obj.$Extensible instanceof BooleanValue ? obj.$Extensible.value : false;
  if (!ext || (obj.unknownProperty !== undefined && obj.unknownProperty.descriptor !== undefined)) return undefined;
  if (IsArray(realm, obj)) {
    if (obj.$Prototype !== realm.intrinsics.ArrayPrototype) return undefined;
    for (let [k, pb] of obj.properties) {
      if (k === "length") continue;
      if (pb !== undefined && pb.descriptor !== undefined) return undefined;
    }
    let lenPb = obj.properties.get("length");
    let lenDesc = lenPb && lenPb.descriptor;
    if (!(lenDesc instanceof PropertyDescriptor) || !(lenDesc.value instanceof NumberValue) || lenDesc.value.value !== 0) {
      return undefined;
    }
    return { isArray: true };
  }
  if (obj.getKind() === "Object" && obj.$Prototype === realm.intrinsics.ObjectPrototype) {
    for (let pb of obj.properties.values()) {
      if (pb !== undefined && pb.descriptor !== undefined) return undefined;
    }
    return { isArray: false };
  }
  return undefined;
}

export function prepareLoopRecomputeBeforeApply(
  realm: Realm,
  ast: BabelNodeForStatement,
  env: LexicalEnvironment,
  labelSet: ?Array<string>,
  effects: Effects,
  minEnvId: number
): void | PreLoopToken {
  if (
    env !== realm.$GlobalEnv ||
    realm.isInPureScope() ||
    realm.instantRender.enabled ||
    !realm.pathConditions.isEmpty() ||
    labelSet != null ||
    !(effects.result instanceof SimpleNormalCompletion)
  ) {
    return undefined;
  }
  let gRec = realm.$GlobalEnv.environmentRecord;
  invariant(gRec instanceof GlobalEnvironmentRecord);
  if (Object.keys(gRec.$DeclarativeRecord.bindings).length > 0) {
    // Avoid shadowing hazards with global let/const bindings
    for (let b of effects.modifiedBindings.keys()) {
      if (b.environment.id < minEnvId) return undefined;
    }
  }
  for (let b of effects.modifiedBindings.keys()) {
    if (b.environment.id < minEnvId) return undefined;
  }
  for (let entry of effects.generator._entries) {
    if (entry instanceof TemporalOperationEntry) {
      if (entry.operationDescriptor.type === "GLOBAL_ASSIGNMENT") continue;
      if (entry.isPure === true && entry.declared !== undefined) continue;
    }
    return undefined;
  }

  let mutatedGlobalsPre: Map<string, Value> = new Map();
  let targetObj: void | ObjectValue;
  for (let [pb, prevDesc] of effects.modifiedProperties.entries()) {
    if (ObjectValue.refuseSerializationOnPropertyBinding(pb)) continue;
    if (pb.object === realm.$GlobalObject) {
      if (typeof pb.key !== "string") return undefined;
      if (!mutatedGlobalsPre.has(pb.key)) {
        let curPb = realm.$GlobalObject.properties.get(pb.key);
        let curDesc = curPb && curPb.descriptor;
        let preVal =
          curDesc instanceof PropertyDescriptor && curDesc.value instanceof Value
            ? curDesc.value
            : realm.intrinsics.undefined;
        mutatedGlobalsPre.set(pb.key, preVal);
      }
      continue;
    }
    if (effects.createdObjects.has(pb.object)) continue;
    // Note: before applyEffects, pb.object.properties currently holds pre-loop state;
    // prevDesc inside modifiedProperties is the post-loop descriptor!
    if (isSameDescriptor(pb.descriptor, prevDesc)) continue;
    if (targetObj === undefined) {
      targetObj = pb.object;
    } else if (targetObj !== pb.object) {
      return undefined;
    }
  }
  if (targetObj === undefined) return undefined;
  let emptyCheck = isEmptyContainerBeforeLoop(realm, targetObj);
  if (emptyCheck === undefined) return undefined;

  let freeInfo = collectFreeIdentifiers(ast);
  if (freeInfo.hasUnsupported) return undefined;

  let targetGlobalName: void | string;
  for (let name of freeInfo.names) {
    if (mutatedGlobalsPre.has(name)) continue;
    let pb = realm.$GlobalObject.properties.get(name);
    let desc = pb && pb.descriptor;
    if (desc instanceof PropertyDescriptor && desc.value === targetObj) {
      targetGlobalName = name;
      break;
    }
  }
  if (targetGlobalName === undefined) return undefined;

  return {
    ast,
    target: targetObj,
    targetIsArray: emptyCheck.isArray,
    targetGlobalName,
    mutatedGlobalsPre,
    freeNames: freeInfo.names,
    minEnvId,
  };
}

export function finalizeLoopRecomputeAfterApply(realm: Realm, token: void | PreLoopToken, effects: Effects): void {
  if (token === undefined) return;
  let { ast, target, targetIsArray, targetGlobalName, mutatedGlobalsPre, freeNames, minEnvId } = token;
  let codeBytes = ast.end && ast.start ? ast.end - ast.start : 80;
  let cost = estimateCreatedGraphCost(target, effects.createdObjects, null, minEnvId);
  if (cost.bytes <= Math.max(codeBytes * 2.0, codeBytes + 150)) return;

  let globalSnapshots: Array<[string, mixed]> = [];
  let readGlobalObjects: Array<ObjectValue> = [];
  let readObjectSnapshots: Array<ObjectSnapshot> = [];
  let allNames = new Set(freeNames);
  for (let k of mutatedGlobalsPre.keys()) allNames.add(k);

  for (let name of allNames) {
    let pb = realm.$GlobalObject.properties.get(name);
    let tok = descriptorToken(pb === undefined ? undefined : pb.descriptor);
    globalSnapshots.push([name, tok]);
    if (
      tok instanceof ObjectValue &&
      tok !== target &&
      !tok.isIntrinsic() &&
      !(tok instanceof FunctionValue) &&
      !effects.createdObjects.has(tok)
    ) {
      readGlobalObjects.push(tok);
      readObjectSnapshots.push(takeObjectSnapshot(tok));
    }
  }

  getLoopMap(realm).set(target, {
    kind: "loop",
    target,
    targetIsArray,
    targetGlobalName,
    ast,
    createdObjects: effects.createdObjects,
    mutatedGlobalsPre,
    globalSnapshots,
    readGlobalObjects,
    readObjectSnapshots,
    outputSnapshots: cost.outputSnapshots,
  });
}

export function getVerifiedRecomputeRecipes(realm: Realm): Map<ObjectValue, RecomputeRecipe> {
  let verified: Map<ObjectValue, RecomputeRecipe> = new Map();
  if (realm.instantRender.enabled) return verified;

  for (let [target, recipe] of getCallMap(realm)) {
    let valid = true;
    for (let [b, valAtCall, allowSelf] of recipe.bindingSnapshots) {
      let curVal = b.initialized ? b.value : undefined;
      if (b.hasLeaked) {
        valid = false;
        break;
      }
      if (curVal === valAtCall) continue;
      if (allowSelf && curVal === target) continue;
      valid = false;
      break;
    }
    if (valid) {
      for (let [name, tokAtCall, allowSelf] of recipe.globalSnapshots) {
        let pb = realm.$GlobalObject.properties.get(name);
        let curTok = descriptorToken(pb === undefined ? undefined : pb.descriptor);
        if (curTok === tokAtCall) continue;
        if (allowSelf && curTok === target) continue;
        valid = false;
        break;
      }
    }
    if (valid) {
      for (let snap of recipe.readObjectSnapshots) {
        if (!verifyObjectSnapshot(snap)) {
          valid = false;
          break;
        }
      }
    }
    if (valid) {
      for (let snap of recipe.outputSnapshots) {
        if (!verifyObjectSnapshot(snap)) {
          valid = false;
          break;
        }
      }
    }
    if (valid) verified.set(target, recipe);
  }

  for (let [target, recipe] of getLoopMap(realm)) {
    let valid = true;
    for (let [name, expectedTok] of recipe.globalSnapshots) {
      let pb = realm.$GlobalObject.properties.get(name);
      let curTok = descriptorToken(pb === undefined ? undefined : pb.descriptor);
      if (curTok !== expectedTok) {
        valid = false;
        break;
      }
    }
    if (valid) {
      for (let snap of recipe.readObjectSnapshots) {
        if (!verifyObjectSnapshot(snap)) {
          valid = false;
          break;
        }
      }
    }
    if (valid) {
      for (let snap of recipe.outputSnapshots) {
        if (!verifyObjectSnapshot(snap)) {
          valid = false;
          break;
        }
      }
    }
    if (valid) verified.set(target, recipe);
  }

  return verified;
}

// Clones a global ForStatement AST and converts hoisted `var` declarations into assignments
// to the already-declared top-level global `var`s.
export function buildRecomputeLoopStatements(
  recipe: LoopRecomputeRecipe,
  declaredGlobals: Set<string>
): Array<BabelNodeStatement> {
  let initializedInHeader: Set<string> = new Set();
  const cloneAndRewriteVars = (node: any): any => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(cloneAndRewriteVars);
    if (
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration" ||
      node.type === "ArrowFunctionExpression"
    ) {
      return t.cloneDeep(node);
    }
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      let exprs = [];
      for (let decl of node.declarations) {
        if (decl.id.type === "Identifier") {
          declaredGlobals.add(decl.id.name);
          if (decl.init) {
            exprs.push(t.assignmentExpression("=", t.identifier(decl.id.name), cloneAndRewriteVars(decl.init)));
          }
        }
      }
      if (exprs.length === 0) return t.emptyStatement();
      let seq = exprs.length === 1 ? exprs[0] : t.sequenceExpression(exprs);
      return t.expressionStatement(seq);
    }
    let copy: any = Object.assign({}, node);
    for (let key in node) {
      if (key === "loc") continue;
      let val = node[key];
      if (Array.isArray(val) || (val && typeof val === "object" && typeof val.type === "string")) {
        copy[key] = cloneAndRewriteVars(val);
      }
    }
    return copy;
  };

  let clonedFor: BabelNodeForStatement = t.cloneDeep(recipe.ast);
  if (clonedFor.init && clonedFor.init.type === "VariableDeclaration" && clonedFor.init.kind === "var") {
    let exprs = [];
    for (let decl of clonedFor.init.declarations) {
      if (decl.id.type === "Identifier") {
        declaredGlobals.add(decl.id.name);
        if (decl.init) {
          initializedInHeader.add(decl.id.name);
          exprs.push(t.assignmentExpression("=", t.identifier(decl.id.name), cloneAndRewriteVars(decl.init)));
        }
      }
    }
    clonedFor.init = exprs.length === 0 ? null : exprs.length === 1 ? exprs[0] : t.sequenceExpression(exprs);
  } else if (clonedFor.init && clonedFor.init.type === "AssignmentExpression" && clonedFor.init.left.type === "Identifier") {
    initializedInHeader.add(clonedFor.init.left.name);
  }
  clonedFor.body = cloneAndRewriteVars(clonedFor.body);

  let stmts: Array<BabelNodeStatement> = [];
  for (let [varName, preVal] of recipe.mutatedGlobalsPre) {
    declaredGlobals.add(varName);
    if (!initializedInHeader.has(varName)) {
      let rhs =
        preVal instanceof UndefinedValue
          ? t.unaryExpression("void", t.numericLiteral(0))
          : preVal instanceof PrimitiveValue
          ? t.valueToNode(preVal.serialize())
          : undefined;
      if (rhs !== undefined) {
        stmts.push(t.expressionStatement(t.assignmentExpression("=", t.identifier(varName), rhs)));
      }
    }
  }
  stmts.push(clonedFor);
  return stmts;
}
