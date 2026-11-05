/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import type { Realm } from "../realm.js";
import type { LexicalEnvironment } from "../environment.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { Add } from "../methods/index.js";
import {
  AbstractValue,
  ConcreteValue,
  NumberValue,
  IntegralValue,
  ObjectValue,
  SymbolValue,
  Value,
} from "../values/index.js";
import type { BabelNodeUpdateExpression } from "@babel/types";
import { Environment, Leak, Properties, To } from "../singletons.js";
import invariant from "../invariant.js";
import { ValuesDomain, TypesDomain } from "../domains/index.js";
import { createOperationDescriptor } from "../utils/generator.js";

export default function(
  ast: BabelNodeUpdateExpression,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  // ECMA262 12.4 Update Expressions

  // Let expr be the result of evaluating UnaryExpression.
  let expr = env.evaluate(ast.argument, strictCode);

  // Let oldValue be ? ToNumber(? GetValue(expr)).
  let oldExpr = Environment.GetValue(realm, expr);
  if (
    !(oldExpr instanceof AbstractValue) &&
    !(oldExpr instanceof ObjectValue && oldExpr.mightBeLeakedObject() && realm.isInPureScope())
  ) {
    let coerced;
    if (realm.isInPureScope() && oldExpr instanceof ObjectValue) {
      let savedHandler = realm.errorHandler;
      let savedSuppress = realm.suppressDiagnostics;
      let effects;
      try {
        realm.suppressDiagnostics = true;
        realm.errorHandler = () => "Fail";
        effects = realm.evaluateForEffects(
          () => {
            let res = To.ToNumberOrAbstract(realm, oldExpr);
            return typeof res === "number" ? IntegralValue.createFromNumberValue(realm, res) : res;
          },
          undefined,
          "UpdateExpression/ToNumber"
        );
      } catch (e) {
        if (!(e instanceof FatalError)) throw e;
      } finally {
        realm.errorHandler = savedHandler;
        realm.suppressDiagnostics = savedSuppress;
      }
      if (effects !== undefined) {
        realm.applyEffects(effects);
        coerced = realm.returnOrThrowCompletion(effects.result);
      }
    } else {
      let res = To.ToNumberOrAbstract(realm, oldExpr);
      coerced = typeof res === "number" ? IntegralValue.createFromNumberValue(realm, res) : res;
    }
    if (coerced instanceof NumberValue) {
      let oldValue = coerced.value;
      let delta = ast.operator === "++" ? 1 : -1;
      invariant(ast.operator === "++" || ast.operator === "--");
      let newValue = Add(realm, oldValue, delta);
      Properties.PutValue(realm, expr, newValue);
      return ast.prefix === true ? newValue : coerced;
    }
    if (coerced !== undefined) oldExpr = coerced;
  }

  invariant(ast.operator === "++" || ast.operator === "--"); // As per BabelNodeUpdateExpression
  let op = ast.operator === "++" ? "+" : "-";
  let oldNumberValue;
  if (oldExpr instanceof AbstractValue && Value.isTypeCompatibleWith(oldExpr.getType(), NumberValue)) {
    oldNumberValue = oldExpr;
  } else if (oldExpr instanceof AbstractValue && To.IsToNumberPure(realm, oldExpr)) {
    oldNumberValue = AbstractValue.createFromUnaryOp(realm, "+", oldExpr, true, ast.argument.loc);
  } else if (oldExpr.getType() === SymbolValue) {
    throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError);
  } else if (realm.isInPureScope()) {
    // In pure scope we have to treat the ToNumber operation as temporal since it
    // might throw or mutate something. We also need to leak the argument due to the
    // possible mutations.
    Leak.value(realm, oldExpr, ast.argument.loc);
    oldNumberValue = realm.evaluateWithPossibleThrowCompletion(
      () =>
        AbstractValue.createTemporalFromBuildFunction(
          realm,
          NumberValue,
          [oldExpr],
          createOperationDescriptor("UNARY_EXPRESSION", { unaryOperator: "+", prefix: true }),
          { skipInvariant: true }
        ),
      TypesDomain.topVal,
      ValuesDomain.topVal
    );
  } else {
    let error = new CompilerDiagnostic(
      "might be a symbol or an object with an unknown valueOf or toString or Symbol.toPrimitive method",
      ast.argument.loc,
      "PP0008",
      "RecoverableError"
    );
    if (realm.handleError(error) === "Fail") throw new FatalError();
    invariant(oldExpr instanceof AbstractValue);
    oldNumberValue = AbstractValue.createFromUnaryOp(realm, "+", oldExpr, true, ast.argument.loc);
  }
  let newAbstractValue;
  if (oldNumberValue instanceof AbstractValue) {
    newAbstractValue = AbstractValue.createFromBinaryOp(realm, op, oldNumberValue, new NumberValue(realm, 1), ast.loc);
  } else {
    invariant(oldNumberValue instanceof ConcreteValue);
    newAbstractValue = ValuesDomain.computeBinary(realm, op, oldNumberValue, new NumberValue(realm, 1));
  }
  Properties.PutValue(realm, expr, newAbstractValue);
  return ast.prefix === true ? newAbstractValue : oldNumberValue;
}
