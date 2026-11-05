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
import type { Value } from "../values/index.js";
import { AbstractValue, StringValue } from "../values/index.js";
import { computeBinary } from "./BinaryExpression.js";
import { Environment, To } from "../singletons.js";
import type { BabelNodeTemplateLiteral } from "@babel/types";

// ECMA262 12.2.9
export default function(
  ast: BabelNodeTemplateLiteral,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  let acc: Value = realm.intrinsics.emptyString;

  for (let i = 0; i < ast.quasis.length; i++) {
    let elem = ast.quasis[i];
    if (elem.value.cooked.length > 0) {
      acc = computeBinary(realm, "+", acc, new StringValue(realm, elem.value.cooked));
    }

    let expr = ast.expressions[i];
    if (expr) {
      let val = Environment.GetValue(realm, env.evaluate(expr, strictCode));
      let strVal =
        val instanceof AbstractValue && To.IsToStringPure(realm, val)
          ? To.ToStringAbstract(realm, val)
          : new StringValue(realm, To.ToStringPartial(realm, val));
      acc = computeBinary(realm, "+", acc, strVal);
    }
  }

  return acc;
}
