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
import invariant from "../invariant.js";
import { AbstractValue, ConcreteValue, Value } from "../values/index.js";
import { Join, Path } from "../singletons.js";

// The maximum number of possible values of an abstract property key for which property accesses
// are evaluated once per key.
export const MAX_KEY_CASES = 8;

// Evaluates f once for each value in cases, under the path condition `value === c`, and joins the
// effects and results. cases must contain every value that value can have at runtime (as computed
// by the values or interval domain); cases ruled out by the current path conditions are skipped.
export function mapCases(
  realm: Realm,
  value: AbstractValue,
  cases: Array<ConcreteValue>,
  f: ConcreteValue => Value
): Value {
  let conditions = new Map();
  for (let c of cases) {
    let condition = AbstractValue.createFromBinaryOp(realm, "===", value, c, value.expressionLocation, undefined, true);
    if (condition.mightNotBeFalse()) conditions.set(c, condition);
  }
  invariant(conditions.size > 0, "the possible values of an abstract value cannot all be infeasible");
  if (conditions.size === 1) {
    for (let c of conditions.keys()) return f(c);
  }
  // A condition known to be true would make the other cases infeasible.
  for (let [c, condition] of conditions) if (!condition.mightNotBeTrue()) return f(c);
  // Like Join.mapAndJoin, but each case also assumes the unsimplified fact `value === c`. The
  // simplified condition (used to join the cases) is usually a formula over the conditions that
  // value depends on, from which the interval domain could not recover the value of value.
  let joinedEffects;
  for (let [c, condition] of conditions) {
    invariant(condition instanceof AbstractValue);
    let fact = AbstractValue.createFromBinaryOp(
      realm,
      "===",
      value,
      c,
      value.expressionLocation,
      undefined,
      true,
      true
    );
    let runCase = () => Path.withCondition(condition, () => Path.withCondition(fact, () => f(c)));
    for (let [otherC, otherCondition] of conditions) {
      if (otherC !== c && otherCondition instanceof AbstractValue) {
        let prev = runCase;
        runCase = () => Path.withInverseCondition(otherCondition, prev);
      }
    }
    let effects = realm.evaluateForEffects(runCase, undefined, "mapCases");
    joinedEffects = joinedEffects === undefined ? effects : Join.joinEffects(condition, effects, joinedEffects);
  }
  invariant(joinedEffects !== undefined);
  realm.applyEffects(joinedEffects);
  return realm.returnOrThrowCompletion(joinedEffects.result);
}
