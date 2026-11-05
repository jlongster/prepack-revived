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
import { AbstractValue, StringValue, Value } from "../values/index.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { Environment, Leak, To } from "../singletons.js";
import { createOperationDescriptor } from "../utils/generator.js";
import type { BabelNodeTemplateLiteral } from "@babel/types";

function concatStrings(realm: Realm, x: Value, y: Value, loc): Value {
  if (x instanceof StringValue && y instanceof StringValue) return new StringValue(realm, x.value + y.value);
  if (x instanceof StringValue && x.value === "") return y;
  if (y instanceof StringValue && y.value === "") return x;
  return AbstractValue.createFromBinaryOp(realm, "+", x, y, loc);
}

// ECMA262 12.2.9
export default function(
  ast: BabelNodeTemplateLiteral,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  let result: Value = realm.intrinsics.emptyString;

  for (let i = 0; i < ast.quasis.length; i++) {
    let elem = ast.quasis[i];
    let cooked = elem.value.cooked;
    if (typeof cooked === "string" && cooked !== "") {
      result = concatStrings(realm, result, new StringValue(realm, cooked), ast.loc);
    }

    let expr = ast.expressions[i];
    if (expr) {
      let val = Environment.GetValue(realm, env.evaluate(expr, strictCode));
      let strVal: Value;
      if (val instanceof AbstractValue) {
        if (To.IsToStringPure(realm, val)) {
          strVal = To.ToStringValue(realm, val);
          if (strVal instanceof AbstractValue && !strVal.isTemporal()) {
            strVal = AbstractValue.convertToTemporalIfArgsAreTemporal(realm, strVal, [val]);
          }
        } else if (realm.isInPureScope() && !realm.instantRender.enabled) {
          strVal = realm.evaluateWithPossibleThrowCompletion(
            () => {
              if (val.mightBeObject()) Leak.value(realm, val);
              return AbstractValue.createTemporalFromBuildFunction(
                realm,
                StringValue,
                [val],
                createOperationDescriptor("COERCE_TO_STRING")
              );
            },
            TypesDomain.topVal,
            ValuesDomain.topVal
          );
        } else {
          strVal = new StringValue(realm, To.ToStringPartial(realm, val));
        }
      } else {
        strVal = new StringValue(realm, To.ToStringPartial(realm, val));
      }
      result = concatStrings(realm, result, strVal, ast.loc);
    }
  }

  return result;
}
