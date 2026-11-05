/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import type { Realm } from "../../realm.js";
import { BigIntValue, HostBigInt, NativeFunctionValue, NumberValue } from "../../values/index.js";
import { To } from "../../singletons.js";

function NumberToBigInt(realm: Realm, num: NumberValue): BigIntValue {
  if (!Number.isInteger(num.value)) {
    throw realm.createErrorThrowCompletion(
      realm.intrinsics.RangeError,
      `The number ${num.value} cannot be converted to a BigInt because it is not an integer`
    );
  }
  return new BigIntValue(realm, HostBigInt(num.value));
}

export default function(realm: Realm): NativeFunctionValue {
  // ECMA262 21.2.1.1 BigInt ( value )
  let func = new NativeFunctionValue(realm, "BigInt", "BigInt", 1, (context, [value], argCount, NewTarget) => {
    if (NewTarget !== undefined) {
      throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "BigInt is not a constructor");
    }
    let arg = value === undefined ? realm.intrinsics.undefined : value.throwIfNotConcrete();
    let prim = To.ToPrimitive(realm, arg, "number");
    if (prim instanceof NumberValue) {
      return NumberToBigInt(realm, prim);
    }
    return To.ToBigInt(realm, prim);
  });

  // ECMA262 21.2.2.1 BigInt.asIntN ( bits, bigint )
  func.defineNativeMethod("asIntN", 2, (context, [bits, bigint]) => {
    let b = To.ToIndex(realm, bits === undefined ? realm.intrinsics.undefined : bits.throwIfNotConcrete());
    let bi = To.ToBigInt(realm, bigint === undefined ? realm.intrinsics.undefined : bigint.throwIfNotConcrete());
    return new BigIntValue(realm, HostBigInt.asIntN(b, bi.value));
  });

  // ECMA262 21.2.2.2 BigInt.asUintN ( bits, bigint )
  func.defineNativeMethod("asUintN", 2, (context, [bits, bigint]) => {
    let b = To.ToIndex(realm, bits === undefined ? realm.intrinsics.undefined : bits.throwIfNotConcrete());
    let bi = To.ToBigInt(realm, bigint === undefined ? realm.intrinsics.undefined : bigint.throwIfNotConcrete());
    return new BigIntValue(realm, HostBigInt.asUintN(b, bi.value));
  });

  return func;
}
