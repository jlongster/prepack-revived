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
import { ThrowCompletion } from "../../completions.js";
import { StringValue, ObjectValue, NativeFunctionValue } from "../../values/index.js";
import { IsPromise, Invoke, SpeciesConstructor, IsCallable, Call, IsConstructor } from "../../methods/index.js";
import { NewPromiseCapability, PerformPromiseThen } from "../../methods/promise.js";
import invariant from "../../invariant.js";

export default function(realm: Realm, obj: ObjectValue): void {
  // ECMA262 25.4.5.1
  obj.defineNativeMethod("catch", 1, (context, [onRejected]) => {
    // 1. Let promise be the this value.
    let promise = context;

    // 2. Return ? Invoke(promise, "then", « undefined, onRejected »).
    return Invoke(realm, promise, "then", [realm.intrinsics.undefined, onRejected]);
  });

  // ECMA262 25.6.5.3 Promise.prototype.finally
  obj.defineNativeMethod("finally", 1, (context, [onFinally]) => {
    let promise = context.throwIfNotConcrete();
    if (!(promise instanceof ObjectValue)) {
      throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError);
    }
    let C = SpeciesConstructor(realm, promise, realm.intrinsics.Promise);
    invariant(IsConstructor(realm, C));
    let thenFinally;
    let catchFinally;
    if (!IsCallable(realm, onFinally)) {
      thenFinally = onFinally;
      catchFinally = onFinally;
    } else {
      thenFinally = new NativeFunctionValue(
        realm,
        undefined,
        undefined,
        1,
        (_ctx, [value]) => {
          let result = Call(realm, onFinally, realm.intrinsics.undefined, []);
          let p = Invoke(realm, C, "resolve", [result]);
          let valueThunk = new NativeFunctionValue(realm, undefined, undefined, 0, () => value, false);
          return Invoke(realm, p, "then", [valueThunk]);
        },
        false
      );
      catchFinally = new NativeFunctionValue(
        realm,
        undefined,
        undefined,
        1,
        (_ctx, [reason]) => {
          let result = Call(realm, onFinally, realm.intrinsics.undefined, []);
          let p = Invoke(realm, C, "resolve", [result]);
          let thrower = new NativeFunctionValue(
            realm,
            undefined,
            undefined,
            0,
            () => {
              throw new ThrowCompletion(reason, realm.currentLocation);
            },
            false
          );
          return Invoke(realm, p, "then", [thrower]);
        },
        false
      );
    }
    return Invoke(realm, promise, "then", [thenFinally, catchFinally]);
  });

  // ECMA262 25.4.5.3
  obj.defineNativeMethod("then", 2, (context, [onFulfilled, onRejected]) => {
    // 1. Let promise be the this value.
    let promise = context;

    // 2. If IsPromise(promise) is false, throw a TypeError exception.
    if (!IsPromise(realm, promise)) {
      throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError);
    }
    invariant(promise instanceof ObjectValue);

    // 3. Let C be ? SpeciesConstructor(promise, %Promise%).
    let C = SpeciesConstructor(realm, promise, realm.intrinsics.Promise);

    // 4. Let resultCapability be ? NewPromiseCapability(C).
    let resultCapability = NewPromiseCapability(realm, C);

    // 5. Return PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability).
    return PerformPromiseThen(realm, promise, onFulfilled, onRejected, resultCapability);
  });

  // ECMA262 25.4.5.4 Promise.prototype [ @@toStringTag ]
  obj.defineNativeProperty(realm.intrinsics.SymbolToStringTag, new StringValue(realm, "Promise"), { writable: false });
}
