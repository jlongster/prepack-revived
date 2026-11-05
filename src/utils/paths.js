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
import { AbstractValue, ConcreteValue, NullValue, UndefinedValue, Value } from "../values/index.js";

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

  add(c: AbstractValue): void {
    invariant(!this._readonly);
    this._assumedConditions.add(c);
    this._failedImplications = undefined;
    this._failedImplicationsDeep = undefined;
    this._failedNegativeImplications = undefined;
    this._failedNegativeImplicationsDeep = undefined;
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
    let realm = e.$Realm;
    let root = realm.pathConditions;
    if (this._assumedConditions.has(e)) return true;
    if (this._impliedConditions !== undefined && this._impliedConditions.has(e)) return true;
    if (this._impliedNegatives !== undefined && this._impliedNegatives.has(e)) return false;
    if (this._failedImplications !== undefined && this._failedImplications.has(e)) return false;
    if (depth > 0 && this._failedImplicationsDeep !== undefined && this._failedImplicationsDeep.has(e)) return false;
    if (depth > 10) return false;
    let savedUsedLeaf = realm._implicationUsedLeaf;
    if (this !== root) realm._implicationUsedLeaf = false;
    try {
      if (this._baseConditions !== undefined && this._baseConditions.implies(e, depth + 1)) {
        return this.cacheImplicationSuccess(e);
      }
      for (let assumedCondition of this._assumedConditions) {
        if (assumedCondition.implies(e, depth + 1)) return this.cacheImplicationSuccess(e);
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
      let target = this !== root && realm._implicationUsedLeaf ? root : this;
      if (depth === 0) {
        if (target._failedImplications === undefined) target._failedImplications = new Set();
        target._failedImplications.add(e);
      } else {
        if (target._failedImplicationsDeep === undefined) target._failedImplicationsDeep = new Set();
        target._failedImplicationsDeep.add(e);
      }
      return false;
    } finally {
      if (this !== root) realm._implicationUsedLeaf = savedUsedLeaf || realm._implicationUsedLeaf;
    }
  }

  cacheImplicationSuccess(e: AbstractValue): true {
    let realm = e.$Realm;
    let root = realm.pathConditions;
    let target = this !== root && realm._implicationUsedLeaf ? root : this;
    if (target._impliedConditions === undefined) target._impliedConditions = new Set();
    target._impliedConditions.add(e);
    return true;
  }

  // this => !val. A false value does not imply that !(this => !val).
  impliesNot(e: Value, depth: number = 0): boolean {
    if (!e.mightNotBeTrue()) return false;
    if (!e.mightNotBeFalse()) return true;
    invariant(e instanceof AbstractValue);
    let realm = e.$Realm;
    let root = realm.pathConditions;
    if (this._assumedConditions.has(e)) return false;
    if (this._impliedConditions !== undefined && this._impliedConditions.has(e)) return false;
    if (this._impliedNegatives !== undefined && this._impliedNegatives.has(e)) return true;
    if (this._failedNegativeImplications !== undefined && this._failedNegativeImplications.has(e)) return false;
    if (depth > 0 && this._failedNegativeImplicationsDeep !== undefined && this._failedNegativeImplicationsDeep.has(e))
      return false;
    if (depth > 10) return false;
    let savedUsedLeaf = realm._implicationUsedLeaf;
    if (this !== root) realm._implicationUsedLeaf = false;
    try {
      if (this._baseConditions !== undefined && this._baseConditions.impliesNot(e, depth + 1)) {
        return this.cacheNegativeImplicationSuccess(e);
      }
      for (let assumedCondition of this._assumedConditions) {
        if (assumedCondition.impliesNot(e, depth + 1)) return this.cacheNegativeImplicationSuccess(e);
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
      let target = this !== root && realm._implicationUsedLeaf ? root : this;
      if (depth === 0) {
        if (target._failedNegativeImplications === undefined) target._failedNegativeImplications = new Set();
        target._failedNegativeImplications.add(e);
      } else {
        if (target._failedNegativeImplicationsDeep === undefined) target._failedNegativeImplicationsDeep = new Set();
        target._failedNegativeImplicationsDeep.add(e);
      }
      return false;
    } finally {
      if (this !== root) realm._implicationUsedLeaf = savedUsedLeaf || realm._implicationUsedLeaf;
    }
  }

  cacheNegativeImplicationSuccess(e: AbstractValue): true {
    let realm = e.$Realm;
    let root = realm.pathConditions;
    let target = this !== root && realm._implicationUsedLeaf ? root : this;
    if (target._impliedNegatives === undefined) target._impliedNegatives = new Set();
    target._impliedNegatives.add(e);
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
        let savedFailed = this._failedImplications;
        let savedFailedNeg = this._failedNegativeImplications;
        let ranRefine = false;
        try {
          for (let assumedCondition of savedBaseConditions._assumedConditions) {
            if (assumedCondition.kind === "||") {
              if (++total > 4) break;
              if (!ranRefine) {
                this._baseConditions = undefined;
                this._failedImplications = undefined;
                this._failedNegativeImplications = undefined;
                ranRefine = true;
              }
              refine(assumedCondition);
            }
          }
        } finally {
          if (ranRefine) {
            this._baseConditions = savedBaseConditions;
            if (this !== refinementTarget) {
              this._failedImplications = savedFailed;
              this._failedNegativeImplications = savedFailedNeg;
            } else {
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
    let resetCounter = depth === 0 && !realm.inSimplificationPath;
    if (resetCounter) realm.abstractValueImpliesCounter = 0;
    try {
      return realm.pathConditions.implies(condition, depth);
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
    let resetCounter = depth === 0 && !realm.inSimplificationPath;
    if (resetCounter) realm.abstractValueImpliesCounter = 0;
    try {
      return realm.pathConditions.impliesNot(condition, depth);
    } finally {
      if (resetCounter) realm.abstractValueImpliesCounter = 0;
    }
  }

  withCondition<T>(condition: Value, evaluate: () => T): T {
    let realm = condition.$Realm;
    if (!condition.mightNotBeFalse()) {
      if (realm.impliesCounterOverflowed) throw new InfeasiblePathError();
      invariant(false, "assuming that false equals true is asking for trouble");
    }
    let savedPath = realm.pathConditions;
    realm.pathConditions = new PathConditionsImplementation(savedPath);
    try {
      pushPathCondition(condition);
      realm.pathConditions.refineBaseConditons(realm);
      return evaluate();
    } catch (e) {
      if (e instanceof InfeasiblePathError) {
        // if condition is true, one of the saved path conditions must be false
        // since we have to assume that those conditions are true we now know that on this path, condition is false
        realm.pathConditions = savedPath;
        pushInversePathCondition(condition);
      }
      throw e;
    } finally {
      realm.pathConditions = savedPath;
    }
  }

  withInverseCondition<T>(condition: Value, evaluate: () => T): T {
    let realm = condition.$Realm;
    if (!condition.mightNotBeTrue()) {
      if (realm.impliesCounterOverflowed) throw new InfeasiblePathError();
      invariant(false, "assuming that false equals true is asking for trouble");
    }
    let savedPath = realm.pathConditions;
    realm.pathConditions = new PathConditionsImplementation(savedPath);
    try {
      pushInversePathCondition(condition);
      realm.pathConditions.refineBaseConditons(realm);
      return evaluate();
    } catch (e) {
      if (e instanceof InfeasiblePathError) {
        // if condition is false, one of the saved path conditions must be false
        // since we have to assume that those conditions are true we now know that on this path, condition is true
        realm.pathConditions = savedPath;
        pushPathCondition(condition);
      }
      throw e;
    } finally {
      realm.pathConditions = savedPath;
    }
  }

  pushAndRefine(condition: Value): void {
    let realm = condition.$Realm;
    let savedPath = realm.pathConditions;
    realm.pathConditions = new PathConditionsImplementation(savedPath);

    pushPathCondition(condition);
    realm.pathConditions.refineBaseConditons(realm);
  }

  pushInverseAndRefine(condition: Value): void {
    let realm = condition.$Realm;
    let savedPath = realm.pathConditions;
    realm.pathConditions = new PathConditionsImplementation(savedPath);

    pushInversePathCondition(condition);
    realm.pathConditions.refineBaseConditons(realm);
  }
}

// A path condition is an abstract value that must be true in this particular code path, so we want to assume as much
function pushPathCondition(condition: Value): void {
  let realm = condition.$Realm;
  if (realm.pathConditions.isReadOnly()) realm.pathConditions = new PathConditionsImplementation(realm.pathConditions);
  if (!condition.mightNotBeFalse()) {
    if (realm.impliesCounterOverflowed) throw new InfeasiblePathError();
    invariant(false, "assuming that false equals true is asking for trouble");
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
    if (right instanceof AbstractValue && right.kind === "conditional") [left, right] === [right, left];
    if (left instanceof AbstractValue && left.kind === "conditional") {
      let [cond, x, y] = left.args;
      if (right instanceof ConcreteValue && x instanceof ConcreteValue && y instanceof ConcreteValue) {
        if (right.equals(x) && !right.equals(y)) {
          pushPathCondition(cond);
        } else if (!right.equals(x) && right.equals(y)) {
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
        if (condition.kind === "!=") {
          // x != null => x !== null && x !== undefined (x may still be falsy: 0, "", false, NaN)
          let leftNeNull = AbstractValue.createFromBinaryOp(realm, "!==", left, realm.intrinsics.null);
          let leftNeUndefined = AbstractValue.createFromBinaryOp(realm, "!==", left, realm.intrinsics.undefined);
          if (!leftNeNull.mightNotBeFalse() || !leftNeUndefined.mightNotBeFalse()) throw new InfeasiblePathError();
          pushPathCondition(leftNeNull);
          pushPathCondition(leftNeUndefined);
        } else if (condition.kind === "==") {
          // x == null => !x && (x === null || x === undefined)
          if (!left.mightNotBeTrue()) throw new InfeasiblePathError();
          pushInversePathCondition(left);
          let leftEqNull = AbstractValue.createFromBinaryOp(realm, "===", left, realm.intrinsics.null);
          let leftEqUndefined = AbstractValue.createFromBinaryOp(realm, "===", left, realm.intrinsics.undefined);
          let c;
          if (!leftEqNull.mightNotBeFalse()) c = leftEqUndefined;
          else if (!leftEqUndefined.mightNotBeFalse()) c = leftEqNull;
          else c = AbstractValue.createFromLogicalOp(realm, "||", leftEqNull, leftEqUndefined);
          if (!c.mightNotBeFalse()) throw new InfeasiblePathError();
          pushPathCondition(c);
        }
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
    if (realm.impliesCounterOverflowed) throw new InfeasiblePathError();
    invariant(false, "assuming that false equals true is asking for trouble");
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
        if (condition.kind === "==") {
          // !(x == null) <=> x != null => x !== null && x !== undefined
          let leftNeNull = AbstractValue.createFromBinaryOp(realm, "!==", left, realm.intrinsics.null);
          let leftNeUndefined = AbstractValue.createFromBinaryOp(realm, "!==", left, realm.intrinsics.undefined);
          if (!leftNeNull.mightNotBeFalse() || !leftNeUndefined.mightNotBeFalse()) throw new InfeasiblePathError();
          pushPathCondition(leftNeNull);
          pushPathCondition(leftNeUndefined);
        } else {
          // !(x != null) <=> x == null => !x && (x === null || x === undefined)
          if (!left.mightNotBeTrue()) throw new InfeasiblePathError();
          pushInversePathCondition(left);
          let leftEqNull = AbstractValue.createFromBinaryOp(realm, "===", left, realm.intrinsics.null);
          let leftEqUndefined = AbstractValue.createFromBinaryOp(realm, "===", left, realm.intrinsics.undefined);
          let c;
          if (!leftEqNull.mightNotBeFalse()) c = leftEqUndefined;
          else if (!leftEqUndefined.mightNotBeFalse()) c = leftEqNull;
          else c = AbstractValue.createFromLogicalOp(realm, "||", leftEqNull, leftEqUndefined);
          if (!c.mightNotBeFalse()) throw new InfeasiblePathError();
          pushPathCondition(c);
        }
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
