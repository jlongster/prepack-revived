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
import { BigIntValue, ObjectValue, StringValue, UndefinedValue, type Value } from "../../values/index.js";
import { To } from "../../singletons.js";

function thisBigIntValue(realm: Realm, value: Value): BigIntValue {
  let v = value.throwIfNotConcrete();
  if (v instanceof BigIntValue) return v;
  if (v instanceof ObjectValue && v.$BigIntData instanceof BigIntValue) return v.$BigIntData;
  if (v instanceof ObjectValue && v.$BigIntData !== undefined) {
    v.$BigIntData.throwIfNotConcrete();
  }
  throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "thisBigIntValue called on incompatible value");
}

export default function(realm: Realm, obj: ObjectValue): void {
  // ECMA262 21.2.3.3 BigInt.prototype.toString ( [ radix ] )
  obj.defineNativeMethod("toString", 0, (context, [radix]) => {
    let x = thisBigIntValue(realm, context);
    let radixMV = 10;
    if (radix !== undefined && !(radix instanceof UndefinedValue)) {
      radixMV = To.ToInteger(realm, radix.throwIfNotConcrete());
    }
    if (radixMV < 2 || radixMV > 36) {
      throw realm.createErrorThrowCompletion(
        realm.intrinsics.RangeError,
        "toString() radix argument must be between 2 and 36"
      );
    }
    return new StringValue(realm, x.value.toString(radixMV));
  });

  // ECMA262 21.2.3.4 BigInt.prototype.valueOf ( )
  obj.defineNativeMethod("valueOf", 0, context => {
    return thisBigIntValue(realm, context);
  });

  // ECMA262 21.2.3.2 BigInt.prototype.toLocaleString ( )
  obj.defineNativeMethod("toLocaleString", 0, context => {
    let x = thisBigIntValue(realm, context);
    return new StringValue(realm, x.value.toString(10));
  });

  // ECMA262 21.2.3.5 BigInt.prototype [ @@toStringTag ]
  obj.defineNativeProperty(realm.intrinsics.SymbolToStringTag, new StringValue(realm, "BigInt"), { writable: false });
}
