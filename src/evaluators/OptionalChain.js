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
import type { LexicalEnvironment } from "../environment.js";
import { Reference } from "../environment.js";
import { AbstractValue, NullValue, StringValue, UndefinedValue, Value } from "../values/index.js";
import { RequireObjectCoercible } from "../methods/index.js";
import { Environment, To } from "../singletons.js";
import type { BabelNode } from "@babel/types";
import invariant from "../invariant.js";
import { EvaluateCall } from "./CallExpression.js";
import { createIsNullishCondition } from "./LogicalExpression.js";

type OptionalStep = {
  kind: "member" | "call",
  node: any,
  optional: boolean,
};

export function evaluateOptionalChain(
  ast: BabelNode,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  onFinal?: (Value | Reference) => Value
): Value {
  let finalize = onFinal || (refOrVal => Environment.GetValue(realm, refOrVal));
  let steps: Array<OptionalStep> = [];
  let cur: any = ast;
  while (cur.type === "OptionalMemberExpression" || cur.type === "OptionalCallExpression") {
    if (cur.type === "OptionalMemberExpression") {
      steps.push({ kind: "member", node: cur, optional: !!cur.optional });
      cur = cur.object;
    } else {
      steps.push({ kind: "call", node: cur, optional: !!cur.optional });
      cur = cur.callee;
    }
  }
  steps.reverse();

  let executeNonNullishStep = (step: OptionalStep, refOrVal: Value | Reference, val: Value): Value | Reference => {
    if (step.kind === "member") {
      let node = step.node;
      let propertyNameValue;
      if (node.computed === true) {
        let propertyNameReference = env.evaluate(node.property, strictCode);
        propertyNameValue = Environment.GetValue(realm, propertyNameReference);
      } else {
        propertyNameValue = new StringValue(realm, node.property.name);
      }
      let bv = RequireObjectCoercible(realm, val, node.object.loc);
      let propertyKey = To.ToPropertyKeyPartial(realm, propertyNameValue);
      return new Reference(bv, propertyKey, strictCode);
    } else {
      let node = step.node;
      let previousLoc = realm.setNextExecutionContextLocation(node.loc);
      try {
        return EvaluateCall(refOrVal, val, node, strictCode, env, realm);
      } finally {
        realm.setNextExecutionContextLocation(previousLoc);
      }
    }
  };

  let runStepsFrom = (i: number, refOrVal: Value | Reference): Value => {
    if (i >= steps.length) {
      return finalize(refOrVal);
    }
    let step = steps[i];
    let val = Environment.GetValue(realm, refOrVal);
    if (step.optional) {
      if (val instanceof NullValue || val instanceof UndefinedValue) {
        return finalize(realm.intrinsics.undefined);
      }
      if (val instanceof AbstractValue) {
        let isNullish = createIsNullishCondition(realm, val, step.node.loc);
        if (!isNullish.mightNotBeTrue()) {
          return finalize(realm.intrinsics.undefined);
        }
        if (isNullish.mightNotBeFalse()) {
          invariant(isNullish instanceof AbstractValue);
          return realm.evaluateWithAbstractConditional(
            isNullish,
            () =>
              realm.evaluateForEffects(() => finalize(realm.intrinsics.undefined), null, "OptionalChain/shortCircuit"),
            () =>
              realm.evaluateForEffects(
                () => {
                  let refinedVal = realm.simplifyAndRefineAbstractValue(val);
                  let next = executeNonNullishStep(step, refOrVal, refinedVal);
                  return runStepsFrom(i + 1, next);
                },
                null,
                "OptionalChain/continue"
              )
          );
        }
      }
    }
    let next = executeNonNullishStep(step, refOrVal, val);
    return runStepsFrom(i + 1, next);
  };

  let baseRefOrVal = env.evaluate(cur, strictCode);
  return runStepsFrom(0, baseRefOrVal);
}

export default function(ast: BabelNode, strictCode: boolean, env: LexicalEnvironment, realm: Realm): Value {
  return evaluateOptionalChain(ast, strictCode, env, realm);
}
