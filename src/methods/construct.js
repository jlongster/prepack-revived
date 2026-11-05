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
import {
  AbstractObjectValue,
  ECMAScriptSourceFunctionValue,
  ObjectValue,
  UndefinedValue,
  NullValue,
  Value,
  EmptyValue,
} from "../values/index.js";
import { IsConstructor, IsStatic } from "./is.js";
import { Get } from "./get.js";
import { HasSomeCompatibleType } from "./has.js";
import { Create, Properties } from "../singletons.js";
import invariant from "../invariant.js";
import type { BabelNodeClassMethod } from "@babel/types";
import { PropertyDescriptor } from "../descriptors.js";

// ECMA262 9.2.8
export function MakeConstructor(
  realm: Realm,
  F: ECMAScriptSourceFunctionValue,
  _writablePrototype?: boolean,
  _prototype?: ObjectValue
): UndefinedValue {
  let writablePrototype = _writablePrototype;
  let prototype = _prototype;
  // 1. Assert: F is an ECMAScript function object.
  invariant(F instanceof ECMAScriptSourceFunctionValue, "expected function value");

  // 2. Assert: F has a [[Construct]] internal method.
  invariant(F.$Construct !== undefined, "expected construct internal method");

  // 3. Assert: F is an extensible object that does not have a prototype own property.
  invariant(F.getExtensible(), "expected extensible object that doesn't have prototype own property");

  // 4. If the writablePrototype argument was not provided, let writablePrototype be true.
  if (writablePrototype === null || writablePrototype === undefined) {
    writablePrototype = true;
  }

  // 5. If the prototype argument was not provided, then
  if (!prototype) {
    // a. Let prototype be ObjectCreate(%ObjectPrototype%).
    prototype = Create.ObjectCreate(realm, realm.intrinsics.ObjectPrototype);
    prototype.originalConstructor = F;

    // b. Perform ! DefinePropertyOrThrow(prototype, "constructor", PropertyDescriptor{[[Value]]: F, [[Writable]]: writablePrototype, [[Enumerable]]: false, [[Configurable]]: true }).
    Properties.DefinePropertyOrThrow(
      realm,
      prototype,
      "constructor",
      new PropertyDescriptor({
        value: F,
        writable: writablePrototype,
        enumerable: false,
        configurable: true,
      })
    );
  }

  // 6. Perform ! DefinePropertyOrThrow(F, "prototype", PropertyDescriptor{[[Value]]: prototype, [[Writable]]: writablePrototype, [[Enumerable]]: false, [[Configurable]]: false}).
  Properties.DefinePropertyOrThrow(
    realm,
    F,
    "prototype",
    new PropertyDescriptor({
      value: prototype,
      writable: writablePrototype,
      enumerable: false,
      configurable: false,
    })
  );

  // 7. Return NormalCompletion(undefined).
  return realm.intrinsics.undefined;
}

// ECMA262 7.3.13
export function Construct(
  realm: Realm,
  F: ObjectValue,
  _argumentsList?: Array<Value>,
  _newTarget?: ObjectValue
): ObjectValue | AbstractObjectValue {
  let argumentsList = _argumentsList;
  let newTarget = _newTarget;
  // If newTarget was not passed, let newTarget be F.
  if (!newTarget) newTarget = F;

  // If argumentsList was not passed, let argumentsList be a new empty List.
  if (!argumentsList) argumentsList = [];

  // Assert: IsConstructor(F) is true.
  invariant(IsConstructor(realm, F), "expected constructor");

  // Assert: IsConstructor(newTarget) is true.
  invariant(IsConstructor(realm, newTarget), "expected constructor");

  // Return ? F.[[Construct]](argumentsList, newTarget).
  invariant(F.$Construct !== undefined, "no construct method on realm value");
  return F.$Construct(argumentsList, newTarget);
}

// ECMA262 7.3.20
export function SpeciesConstructor(realm: Realm, O: ObjectValue, defaultConstructor: ObjectValue): ObjectValue {
  // 1. Assert: Type(O) is Object.
  invariant(O instanceof ObjectValue, "Type(O) is Object");

  // 2. Let C be ? Get(O, "constructor").
  let C = Get(realm, O, "constructor");

  // 3. If C is undefined, return defaultConstructor.
  if (C instanceof UndefinedValue) return defaultConstructor;

  // 4. If Type(C) is not Object, throw a TypeError exception.
  if (C.mightNotBeObject()) {
    if (C.mightBeObject()) C.throwIfNotConcrete();
    throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "Type(C) is not an object");
  }
  invariant(C instanceof ObjectValue || C instanceof AbstractObjectValue);

  // 5. Let S be ? Get(C, @@species).
  let S = Get(realm, C, realm.intrinsics.SymbolSpecies);

  // 6. If S is either undefined or null, return defaultConstructor.
  if (HasSomeCompatibleType(S, UndefinedValue, NullValue)) return defaultConstructor;

  // 7. If IsConstructor(S) is true, return S.
  if (IsConstructor(realm, S)) {
    invariant(S instanceof ObjectValue);
    return S;
  }

  // 8. Throw a TypeError exception.
  throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "Throw a TypeError exception");
}

// ECMA 9.2.9
export function MakeClassConstructor(realm: Realm, F: ECMAScriptSourceFunctionValue): UndefinedValue {
  // 1. Assert: F is an ECMAScript function object.
  invariant(F instanceof ECMAScriptSourceFunctionValue, "expected function value");

  // 2. Assert: F’s [[FunctionKind]] internal slot is "normal".
  invariant(F.$FunctionKind === "normal");

  // 3. Set F’s [[FunctionKind]] internal slot to "classConstructor".
  F.$FunctionKind = "classConstructor";

  // 4. Return NormalCompletion(undefined).
  return realm.intrinsics.undefined;
}

function isConstructorClassMethod(elem: BabelNodeClassMethod): boolean {
  if (IsStatic(elem) || elem.computed === true) return false;
  if ((elem.key.type: string) === "PrivateName") return false;
  return elem.key.name === "constructor" || elem.key.value === "constructor";
}

// ECMA 14.5.3
export function ConstructorMethod(
  realm: Realm,
  ClassElementList: Array<BabelNodeClassMethod>
): EmptyValue | BabelNodeClassMethod {
  for (let elem of ClassElementList) {
    if (isConstructorClassMethod(elem)) return elem;
  }
  return realm.intrinsics.empty;
}

// ECMA 14.5.10
export function NonConstructorMethodDefinitions(
  realm: Realm,
  ClassElementList: Array<BabelNodeClassMethod>
): Array<BabelNodeClassMethod> {
  return ClassElementList.filter(elem => !isConstructorClassMethod(elem));
}
