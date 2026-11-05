/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import { InfeasiblePathError } from "../errors.js";
import invariant from "../invariant.js";
import { Realm } from "../realm.js";
import { PathConditions } from "../types.js";
import { AbstractValue, ConcreteValue, NullValue, NumberValue, UndefinedValue, Value } from "../values/index.js";
import {
  auditDerivedCondition,
  auditImplication,
  smtAuditing,
  smtEnabled,
  smtImplies,
  smtImpliesNot,
} from "./smt/index.js";

export class PathConditionsImplementation extends PathConditions {
  constructor(baseConditions?: void | PathConditions) {
    super();
    this._assumedConditions = new Set();
    this._readonly = false;
    if (baseConditions !== undefined) {
      invariant(baseConditions instanceof PathConditionsImplementation);
      this._baseConditions = baseConditions;
    }
  }

  _assumedConditions: Set<AbstractValue>;
  _readonly: boolean;
  _baseConditions: void | PathConditionsImplementation;
  _impliedConditions: void | Set<AbstractValue>;
  _impliedNegatives: void | Set<AbstractValue>;
  _failedImplications: void | Set<AbstractValue>;
  _failedImplicationsDeep: void | Set<AbstractValue>;
  _failedNegativeImplications: void | Set<AbstractValue>;
  _failedNegativeImplicationsDeep: void | Set<AbstractValue>;
  _smtFailedImplications: void | Map<number, Array<AbstractValue>>;
  _smtFailedNegatives: void | Map<number, Array<AbstractValue>>;

  add(c: AbstractValue): void {
    invariant(!this._readonly);
    this._assumedConditions.add(c);
    this._failedImplications = undefined;
    this._failedImplicationsDeep = undefined;
    this._failedNegativeImplications = undefined;
    this._failedNegativeImplicationsDeep = undefined;
    this._smtFailedImplications = undefined;
    this._smtFailedNegatives = undefined;
  }

  // It makes the strong assumption that, in order for 2 path conditions to be equal,
  // the number of values must be the same, as well as their order.
  // This might not always be the case, yielding false negatives?!
  equals(x: PathConditions): boolean {
    invariant(x instanceof PathConditionsImplementation);
    let conditionsAreEqual = () => {
      if (this._assumedConditions.size !== x._assumedConditions.size) return false;
      let thisConditions = Array.from(this._assumedConditions);
      let xConditions = Array.from(x._assumedConditions);
      let thisLength = thisConditions.length;
      for (let i = 0; i < thisLength; i++) {
        let thisCondition = thisConditions[i];
        let xCondition = xConditions[i];
        if (!thisCondition.equals(xCondition)) return false;
      }
      return true;
    };
    let baseConditionsAreEqual = () => {
      if (this._baseConditions && !x._baseConditions) return false;
      if (!this._baseConditions && x._baseConditions) return false;
      if (this._baseConditions && x._baseConditions) return this._baseConditions.equals(x._baseConditions);
      return true;
    };
    return this === x || (conditionsAreEqual() && baseConditionsAreEqual());
  }

  isReadOnly(): boolean {
    return this._readonly;
  }

  // this => val. A false value does not imply that !(this => val).
  implies(e: Value, depth: number = 0): boolean {
    if (!e.mightNotBeTrue()) return true;
    if (!e.mightNotBeFalse()) return false;
    invariant(e instanceof AbstractValue);
    if (this._assumedConditions.has(e)) return true;
    if (this._impliedConditions !== undefined && this._impliedConditions.has(e)) return true;
    if (this._impliedNegatives !== undefined && this._impliedNegatives.has(e)) return false;
    if (this._failedImplications !== undefined && this._failedImplications.has(e)) return false;
    if (depth > 0 && this._failedImplicationsDeep !== undefined && this._failedImplicationsDeep.has(e)) return false;
    if (depth > 10) return false;
    if (this._baseConditions !== undefined && this._baseConditions.implies(e, depth + 1)) {
      return this.cacheImplicationSuccess(e);
    }
    for (let assumedCondition of this._assumedConditions) {
      if (assumedCondition.implies(e, depth + 1, this)) return this.cacheImplicationSuccess(e);
    }
    if (e.kind === "||") {
      let [x, y] = e.args;
      if (!x.mightNotBeTrue() || !y.mightNotBeTrue()) return this.cacheImplicationSuccess(e);
      if (!x.mightNotBeFalse() && this.implies(y, depth + 1)) return this.cacheImplicationSuccess(e);
      if (!y.mightNotBeFalse() && this.implies(x, depth + 1)) return this.cacheImplicationSuccess(e);
      if (this.implies(x, depth + 1)) return this.cacheImplicationSuccess(e);
      if (this.implies(y, depth + 1)) return this.cacheImplicationSuccess(e);
    }
    if (e.kind === "!==" || e.kind === "!=") {
      let [x, y] = e.args;
      if (x instanceof AbstractValue) {
        if ((y instanceof NullValue || y instanceof UndefinedValue) && this.implies(x, depth + 1))
          return this.cacheImplicationSuccess(e);
      } else {
        invariant(y instanceof AbstractValue);
        if ((x instanceof NullValue || x instanceof UndefinedValue) && this.implies(y, depth + 1))
          return this.cacheImplicationSuccess(e);
      }
    }
    if (e.kind === "!") {
      let [x] = e.args;
      if (this.impliesNot(x, depth + 1)) return this.cacheImplicationSuccess(e);
    }
    if (depth === 0) {
      if (this._failedImplications === undefined) this._failedImplications = new Set();
      this._failedImplications.add(e);
    } else {
      if (this._failedImplicationsDeep === undefined) this._failedImplicationsDeep = new Set();
      this._failedImplicationsDeep.add(e);
    }
    return false;
  }

  cacheImplicationSuccess(e: AbstractValue): true {
    if (this._impliedConditions === undefined) this._impliedConditions = new Set();
    this._impliedConditions.add(e);
    return true;
  }

  // this => !val. A false value does not imply that !(this => !val).
  impliesNot(e: Value, depth: number = 0): boolean {
    if (!e.mightNotBeTrue()) return false;
    if (!e.mightNotBeFalse()) return true;
    invariant(e instanceof AbstractValue);
    if (this._assumedConditions.has(e)) return false;
    if (this._impliedConditions !== undefined && this._impliedConditions.has(e)) return false;
    if (this._impliedNegatives !== undefined && this._impliedNegatives.has(e)) return true;
    if (this._failedNegativeImplications !== undefined && this._failedNegativeImplications.has(e)) return false;
    if (depth > 0 && this._failedNegativeImplicationsDeep !== undefined && this._failedNegativeImplicationsDeep.has(e))
      return false;
    if (depth > 10) return false;
    if (this._baseConditions !== undefined && this._baseConditions.impliesNot(e, depth + 1)) {
      return this.cacheNegativeImplicationSuccess(e);
    }
    for (let assumedCondition of this._assumedConditions) {
      if (assumedCondition.impliesNot(e, depth + 1, this)) return this.cacheNegativeImplicationSuccess(e);
    }
    if (e.kind === "&&") {
      let [x, y] = e.args;
      if (!x.mightNotBeFalse() || !y.mightNotBeFalse()) return this.cacheNegativeImplicationSuccess(e);
      if (!x.mightNotBeTrue() && this.impliesNot(y, depth + 1)) return this.cacheNegativeImplicationSuccess(e);
      if (!y.mightNotBeTrue() && this.impliesNot(x, depth + 1)) return this.cacheNegativeImplicationSuccess(e);
      if (this.impliesNot(x, depth + 1)) return this.cacheNegativeImplicationSuccess(e);
      if (this.impliesNot(y, depth + 1)) return this.cacheNegativeImplicationSuccess(e);
    }
    if (e.kind === "===" || e.kind === "==") {
      let [x, y] = e.args;
      if (x instanceof AbstractValue) {
        if ((y instanceof NullValue || y instanceof UndefinedValue) && this.implies(x, depth + 1))
          return this.cacheNegativeImplicationSuccess(e);
      } else {
        invariant(y instanceof AbstractValue);
        if ((x instanceof NullValue || x instanceof UndefinedValue) && this.implies(y, depth + 1))
          return this.cacheNegativeImplicationSuccess(e);
      }
    }
    if (e.kind === "!") {
      let [x] = e.args;
      if (this.implies(x, depth + 1)) return this.cacheNegativeImplicationSuccess(e);
    }
    if (depth === 0) {
      if (this._failedNegativeImplications === undefined) this._failedNegativeImplications = new Set();
      this._failedNegativeImplications.add(e);
    } else {
      if (this._failedNegativeImplicationsDeep === undefined) this._failedNegativeImplicationsDeep = new Set();
      this._failedNegativeImplicationsDeep.add(e);
    }
    return false;
  }

  cacheNegativeImplicationSuccess(e: AbstractValue): true {
    if (this._impliedNegatives === undefined) this._impliedNegatives = new Set();
    this._impliedNegatives.add(e);
    return true;
  }

  isEmpty(): boolean {
    return this._assumedConditions.size === 0;
  }

  getLength(): number {
    return this._assumedConditions.size;
  }

  getAssumedConditions(): Set<AbstractValue> {
    return this._assumedConditions;
  }

  // All conditions assumed on this path, including those of the base conditions.
  getAllConditions(): Array<AbstractValue> {
    let result = new Set();
    for (let p = this; p !== undefined; p = p._baseConditions) for (let c of p._assumedConditions) result.add(c);
    return Array.from(result);
  }

  // Refinement may temporarily make a target non-read-only, but marks the target as read-only at the end.
  refineBaseConditons(
    realm: Realm,
    totalRefinements: number = 0,
    refinementTarget: PathConditionsImplementation = this
  ): void {
    try {
      if (realm.abstractValueImpliesMax > 0) return;
      let total = totalRefinements;
      let refine = (condition: AbstractValue) => {
        let refinedCondition = realm.simplifyAndRefineAbstractCondition(condition);
        if (refinedCondition !== condition) {
          if (!refinedCondition.mightNotBeFalse()) throw new InfeasiblePathError();
          if (refinedCondition instanceof AbstractValue) {
            refinementTarget._readonly = false;
            refinementTarget.add(refinedCondition);
          }
        }
      };
      if (this._baseConditions !== undefined) {
        let savedBaseConditions = this._baseConditions;
        let savedImplied = this._impliedConditions;
        let savedImpliedNegatives = this._impliedNegatives;
        let savedFailed = this._failedImplications;
        let savedFailedNeg = this._failedNegativeImplications;
        // Caches between the target and this may record implications that depend on the conditions detached below.
        let savedChainCaches = [];
        for (let p = refinementTarget; p !== undefined && p !== this; p = p._baseConditions)
          savedChainCaches.push([p, p._impliedConditions, p._impliedNegatives]);
        let ranRefine = false;
        try {
          for (let assumedCondition of savedBaseConditions._assumedConditions) {
            if (assumedCondition.kind === "||") {
              if (++total > 4) break;
              if (!ranRefine) {
                this._baseConditions = undefined;
                this._impliedConditions = undefined;
                this._impliedNegatives = undefined;
                this._failedImplications = undefined;
                this._failedNegativeImplications = undefined;
                for (let [p] of savedChainCaches) {
                  p._impliedConditions = undefined;
                  p._impliedNegatives = undefined;
                }
                ranRefine = true;
              }
              refine(assumedCondition);
            }
          }
        } finally {
          if (ranRefine) {
            this._baseConditions = savedBaseConditions;
            if (this !== refinementTarget) {
              this._impliedConditions = savedImplied;
              this._impliedNegatives = savedImpliedNegatives;
              this._failedImplications = savedFailed;
              this._failedNegativeImplications = savedFailedNeg;
              for (let [p, implied, impliedNegatives] of savedChainCaches) {
                p._impliedConditions = implied;
                p._impliedNegatives = impliedNegatives;
              }
            } else {
              this._impliedConditions = undefined;
              this._impliedNegatives = undefined;
              this._failedImplications = undefined;
              this._failedNegativeImplications = undefined;
            }
          }
        }
        if (total <= 4) savedBaseConditions.refineBaseConditons(realm, total, refinementTarget);
      }
    } finally {
      refinementTarget._readonly = true;
    }
  }
}

export class PathImplementation {
  // this => val. A false value does not imply that !(this => val).
  implies(condition: Value, depth: number = 0): boolean {
    if (!condition.mightNotBeTrue()) return true; // any path implies true
    if (!condition.mightNotBeFalse()) return false; // no path condition is false
    invariant(condition instanceof AbstractValue);
    let realm = condition.$Realm;
    let pathConditions = realm.pathConditions;
    invariant(pathConditions instanceof PathConditionsImplementation);
    let resetCounter = depth === 0 && !realm.inSimplificationPath;
    if (resetCounter) realm.abstractValueImpliesCounter = 0;
    try {
      if (pathConditions.implies(condition, depth)) {
        if (smtAuditing(realm)) auditImplication(realm, pathConditions.getAllConditions(), condition, false);
        return true;
      }
      if (!smtEnabled(realm)) return false;
      // The hand-written rules don't know: ask the solver.
      if (hasEquivalent(pathConditions._smtFailedImplications, condition)) return false;
      let allConditions = pathConditions.getAllConditions();
      if (allConditions.length === 0 && isAtomicAbstractValue(condition)) return false;
      if (smtImplies(allConditions, condition)) return pathConditions.cacheImplicationSuccess(condition);
      if (pathConditions._smtFailedImplications === undefined) pathConditions._smtFailedImplications = new Map();
      addEquivalent(pathConditions._smtFailedImplications, condition);
      return false;
    } finally {
      if (resetCounter) realm.abstractValueImpliesCounter = 0;
    }
  }

  // this => !val. A false value does not imply that !(this => !val).
  impliesNot(condition: Value, depth: number = 0): boolean {
    if (!condition.mightNotBeFalse()) return true; // any path implies !false
    if (!condition.mightNotBeTrue()) return false; // no path condition is false, so none can imply !true
    invariant(condition instanceof AbstractValue);
    let realm = condition.$Realm;
    let pathConditions = realm.pathConditions;
    invariant(pathConditions instanceof PathConditionsImplementation);
    let resetCounter = depth === 0 && !realm.inSimplificationPath;
    if (resetCounter) realm.abstractValueImpliesCounter = 0;
    try {
      if (pathConditions.impliesNot(condition, depth)) {
        if (smtAuditing(realm)) auditImplication(realm, pathConditions.getAllConditions(), condition, true);
        return true;
      }
      if (!smtEnabled(realm)) return false;
      if (hasEquivalent(pathConditions._smtFailedNegatives, condition)) return false;
      let allConditions = pathConditions.getAllConditions();
      if (allConditions.length === 0 && isAtomicAbstractValue(condition)) return false;
      if (smtImpliesNot(allConditions, condition)) return pathConditions.cacheNegativeImplicationSuccess(condition);
      if (pathConditions._smtFailedNegatives === undefined) pathConditions._smtFailedNegatives = new Map();
      addEquivalent(pathConditions._smtFailedNegatives, condition);
      return false;
    } finally {
      if (resetCounter) realm.abstractValueImpliesCounter = 0;
    }
  }

  withCondition<T>(condition: Value, evaluate: () => T): T {
    let realm = condition.$Realm;
    if (!condition.mightNotBeFalse()) {
      throw new InfeasiblePathError();
    }
    let savedPath = realm.pathConditions;
    realm.pathConditions = new PathConditionsImplementation(savedPath);
    try {
      if (smtProvesInfeasible(savedPath, condition, false)) throw new InfeasiblePathError();
      pushPathCondition(condition);
      realm.pathConditions.refineBaseConditons(realm);
      if (smtAuditing(realm)) auditPush(savedPath, condition, false);
      return evaluate();
    } catch (e) {
      if (e instanceof InfeasiblePathError) {
        // if condition is true, one of the saved path conditions must be false
        // since we have to assume that those conditions are true we now know that on this path, condition is false
        realm.pathConditions = savedPath;
        pushInverseAndRefineImpl(condition);
        savedPath = realm.pathConditions;
      }
      throw e;
    } finally {
      realm.pathConditions = savedPath;
    }
  }

  withInverseCondition<T>(condition: Value, evaluate: () => T): T {
    let realm = condition.$Realm;
    if (!condition.mightNotBeTrue()) {
      throw new InfeasiblePathError();
    }
    let savedPath = realm.pathConditions;
    realm.pathConditions = new PathConditionsImplementation(savedPath);
    try {
      if (smtProvesInfeasible(savedPath, condition, true)) throw new InfeasiblePathError();
      pushInversePathCondition(condition);
      realm.pathConditions.refineBaseConditons(realm);
      if (smtAuditing(realm)) auditPush(savedPath, condition, true);
      return evaluate();
    } catch (e) {
      if (e instanceof InfeasiblePathError) {
        // if condition is false, one of the saved path conditions must be false
        // since we have to assume that those conditions are true we now know that on this path, condition is true
        realm.pathConditions = savedPath;
        pushAndRefineImpl(condition);
        savedPath = realm.pathConditions;
      }
      throw e;
    } finally {
      realm.pathConditions = savedPath;
    }
  }

  pushAndRefine(condition: Value): void {
    pushAndRefineImpl(condition);
  }

  pushInverseAndRefine(condition: Value): void {
    pushInverseAndRefineImpl(condition);
  }
}

function pushAndRefineImpl(condition: Value): void {
  let realm = condition.$Realm;
  let savedPath = realm.pathConditions;
  realm.pathConditions = new PathConditionsImplementation(savedPath);
  try {
    pushPathCondition(condition);
    realm.pathConditions.refineBaseConditons(realm);
    if (smtAuditing(realm)) auditPush(savedPath, condition, false);
  } catch (e) {
    realm.pathConditions = savedPath;
    throw e;
  }
}

function pushInverseAndRefineImpl(condition: Value): void {
  let realm = condition.$Realm;
  let savedPath = realm.pathConditions;
  realm.pathConditions = new PathConditionsImplementation(savedPath);
  try {
    pushInversePathCondition(condition);
    realm.pathConditions.refineBaseConditons(realm);
    if (smtAuditing(realm)) auditPush(savedPath, condition, true);
  } catch (e) {
    realm.pathConditions = savedPath;
    throw e;
  }
}

// Does the solver prove that the path `base` can not continue with `condition` (or its inverse)?
function smtProvesInfeasible(base: PathConditions, condition: Value, inverse: boolean): boolean {
  if (!(condition instanceof AbstractValue)) return false;
  let realm = condition.$Realm;
  if (!smtEnabled(realm)) return false;
  invariant(base instanceof PathConditionsImplementation);
  let conditions = base.getAllConditions();
  if (conditions.length === 0 && isAtomicAbstractValue(condition)) return false;
  return inverse ? smtImplies(conditions, condition) : smtImpliesNot(conditions, condition);
}

function hasEquivalent(map: void | Map<number, Array<AbstractValue>>, c: AbstractValue): boolean {
  if (map === undefined) return false;
  let bucket = map.get(c.hashValue);
  if (bucket === undefined) return false;
  return bucket.some(x => x === c || x.equals(c));
}

function addEquivalent(map: Map<number, Array<AbstractValue>>, c: AbstractValue): void {
  let bucket = map.get(c.hashValue);
  if (bucket === undefined) map.set(c.hashValue, [c]);
  else bucket.push(c);
}

function isAtomicAbstractValue(v: AbstractValue): boolean {
  if (v.intrinsicName !== undefined) {
    let entry = v.$Realm.getTemporalOperationEntryFromDerivedValue(v);
    if (entry === undefined) return true;
    if (
      entry.isPure === true ||
      entry.operationDescriptor.type === "BINARY_EXPRESSION" ||
      entry.operationDescriptor.type === "UNARY_EXPRESSION"
    ) {
      return false;
    }
    return true;
  }
  return v.operationDescriptor === undefined || v.operationDescriptor.type === "IDENTIFIER";
}

// Audit: every condition that pushing `condition` added to the path must follow from the base path and `condition`.
function auditPush(base: PathConditions, condition: Value, inverse: boolean): void {
  let realm = condition.$Realm;
  let current = realm.pathConditions;
  invariant(base instanceof PathConditionsImplementation && current instanceof PathConditionsImplementation);
  let baseConditions = base.getAllConditions();
  let known = new Set(baseConditions);
  for (let derived of current.getAllConditions()) {
    if (known.has(derived) || derived === condition) continue;
    auditDerivedCondition(realm, baseConditions, condition, inverse, derived);
  }
}

// A path condition is an abstract value that must be true in this particular code path, so we want to assume as much
function pushPathCondition(condition: Value): void {
  let realm = condition.$Realm;
  if (realm.pathConditions.isReadOnly()) realm.pathConditions = new PathConditionsImplementation(realm.pathConditions);
  if (!condition.mightNotBeFalse()) {
    throw new InfeasiblePathError();
  }
  if (condition instanceof ConcreteValue) return;
  if (!condition.mightNotBeTrue()) return;
  invariant(condition instanceof AbstractValue);
  if (condition.kind === "&&") {
    let left = condition.args[0];
    let right = condition.args[1];
    invariant(left instanceof AbstractValue); // it is a mistake to create an abstract value when concrete value will do
    pushPathCondition(left);
    pushPathCondition(right);
  } else if (condition.kind === "===") {
    let [left, right] = condition.args;
    if (right instanceof AbstractValue && right.kind === "conditional") [left, right] = [right, left];
    if (left instanceof AbstractValue && left.kind === "conditional") {
      let [cond, x, y] = left.args;
      if (right instanceof ConcreteValue && x instanceof ConcreteValue && y instanceof ConcreteValue) {
        if (concreteStrictEqual(right, x) && !concreteStrictEqual(right, y)) {
          pushPathCondition(cond);
        } else if (!concreteStrictEqual(right, x) && concreteStrictEqual(right, y)) {
          pushInversePathCondition(cond);
        }
      }
    }
    realm.pathConditions.add(condition);
  } else {
    if (condition.kind === "!=" || condition.kind === "==") {
      let left = condition.args[0];
      let right = condition.args[1];
      if (left instanceof ConcreteValue && right instanceof AbstractValue) [left, right] = [right, left];
      if (left instanceof AbstractValue && (right instanceof UndefinedValue || right instanceof NullValue)) {
        pushNullishCheck(realm, left, condition.kind === "==");
        return;
      }
    }
    realm.pathConditions.add(condition);
  }
}

// An inverse path condition is an abstract value that must be false in this particular code path, so we want to assume as much
function pushInversePathCondition(condition: Value): void {
  let realm = condition.$Realm;
  if (realm.pathConditions.isReadOnly()) realm.pathConditions = new PathConditionsImplementation(realm.pathConditions);
  if (!condition.mightNotBeTrue()) {
    throw new InfeasiblePathError();
  }
  if (condition instanceof ConcreteValue) return;
  invariant(condition instanceof AbstractValue);
  if (condition.kind === "||") {
    let left = condition.args[0];
    let right = condition.args[1];
    invariant(left instanceof AbstractValue); // it is a mistake to create an abstract value when concrete value will do
    pushInversePathCondition(left);
    if (right instanceof AbstractValue) right = realm.simplifyAndRefineAbstractCondition(right);
    if (right.mightNotBeTrue()) pushInversePathCondition(right);
  } else {
    if (condition.kind === "!=" || condition.kind === "==") {
      let left = condition.args[0];
      let right = condition.args[1];
      if (left instanceof ConcreteValue && right instanceof AbstractValue) [left, right] = [right, left];
      if (left instanceof AbstractValue && (right instanceof UndefinedValue || right instanceof NullValue)) {
        pushNullishCheck(realm, left, condition.kind === "!=");
        return;
      }
    }
    let inverseCondition = AbstractValue.createFromUnaryOp(realm, "!", condition, false, undefined, true, true);
    pushPathCondition(inverseCondition);
    if (inverseCondition instanceof AbstractValue) {
      let simplifiedInverseCondition = realm.simplifyAndRefineAbstractCondition(inverseCondition);
      if (!simplifiedInverseCondition.equals(inverseCondition)) pushPathCondition(simplifiedInverseCondition);
    }
  }
}

function concreteStrictEqual(a: ConcreteValue, b: ConcreteValue): boolean {
  return a instanceof NumberValue && b instanceof NumberValue ? a.value === b.value : a.equals(b);
}

// True only when `null` and `undefined` are the sole falsy runtime values `v` can take (so `v != null` implies `!!v`).
function onlyNullOrUndefinedCanBeFalsy(v: AbstractValue): boolean {
  if (!v.mightBeFalse()) return true;
  if (v.kind === "abstractConcreteUnion" && v.args.length > 1) {
    return (
      !v.args[0].mightBeFalse() && v.args.slice(1).every(c => c instanceof NullValue || c instanceof UndefinedValue)
    );
  }
  return false;
}

function pushNullishCheck(realm: Realm, left: AbstractValue, isNullish: boolean): void {
  if (isNullish) {
    // left == null => !left && (left === null || left === undefined)
    pushInversePathCondition(left);
    let leftEqNull = AbstractValue.createFromBinaryOp(realm, "===", left, realm.intrinsics.null);
    let leftEqUndefined = AbstractValue.createFromBinaryOp(realm, "===", left, realm.intrinsics.undefined);
    let c;
    if (!leftEqNull.mightNotBeFalse()) c = leftEqUndefined;
    else if (!leftEqUndefined.mightNotBeFalse()) c = leftEqNull;
    else c = AbstractValue.createFromLogicalOp(realm, "||", leftEqNull, leftEqUndefined);
    pushPathCondition(c);
  } else {
    // left != null => left !== null && left !== undefined (and left is truthy only when no other falsy value is possible)
    if (onlyNullOrUndefinedCanBeFalsy(left)) pushPathCondition(left);
    let leftNeNull = AbstractValue.createFromBinaryOp(realm, "!==", left, realm.intrinsics.null);
    let leftNeUndefined = AbstractValue.createFromBinaryOp(realm, "!==", left, realm.intrinsics.undefined);
    pushPathCondition(leftNeNull);
    pushPathCondition(leftNeUndefined);
  }
}
