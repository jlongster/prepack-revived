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
import { Join } from "../singletons.js";

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
    let condition = AbstractValue.createFromBinaryOp(realm, "===", value, c, value.expressionLocation);
    if (condition.mightNotBeFalse()) conditions.set(c, condition);
  }
  invariant(conditions.size > 0, "the possible values of an abstract value cannot all be infeasible");
  if (conditions.size === 1) {
    for (let c of conditions.keys()) return f(c);
  }
  // A condition known to be true would make the other cases infeasible.
  for (let [c, condition] of conditions) if (!condition.mightNotBeTrue()) return f(c);
  return Join.mapAndJoin(
    realm,
    new Set(conditions.keys()),
    c => {
      let condition = conditions.get(c);
      invariant(condition !== undefined);
      return condition;
    },
    f
  );
}
