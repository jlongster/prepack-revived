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
import {
  AbstractObjectValue,
  AbstractValue,
  FunctionValue,
  NativeFunctionValue,
  UndefinedValue,
  StringValue,
  NullValue,
} from "../../values/index.js";
import { IsArray } from "../../methods/is.js";
import { Get } from "../../methods/get.js";
import { To } from "../../singletons.js";
import { isEnvironmentDerived } from "../env/models.js";
import invariant from "../../invariant.js";

export default function(realm: Realm): NativeFunctionValue {
  // ECMA262 22.1.3.30
  let toStringFn = new NativeFunctionValue(
    realm,
    "Object.prototype.toString",
    "toString",
    0,
    context => {
      if (context instanceof AbstractValue) {
        context = realm.simplifyAndRefineAbstractValue(context);
      }
      if (context instanceof AbstractValue && context.kind === "conditional" && isEnvironmentDerived(context)) {
        let [cond, leftVal, rightVal] = context.args;
        invariant(cond instanceof AbstractValue);
        return realm.evaluateWithAbstractConditional(
          cond,
          () => realm.evaluateForEffects(() => toStringFn.$Call(leftVal, []), undefined, "ObjProtoToStringCond/1"),
          () => realm.evaluateForEffects(() => toStringFn.$Call(rightVal, []), undefined, "ObjProtoToStringCond/2")
        );
      }
      if (context instanceof AbstractValue && context.kind === "||" && isEnvironmentDerived(context)) {
        let [leftVal, rightVal] = context.args;
        invariant(leftVal instanceof AbstractValue);
        return realm.evaluateWithAbstractConditional(
          leftVal,
          () => realm.evaluateForEffects(() => toStringFn.$Call(leftVal, []), undefined, "ObjProtoToStringOr/1"),
          () => realm.evaluateForEffects(() => toStringFn.$Call(rightVal, []), undefined, "ObjProtoToStringOr/2")
        );
      }
      if (
        context instanceof AbstractObjectValue &&
        context.isEnvironmentValue === true &&
        context.getType() === FunctionValue &&
        !context.mightBeNull() &&
        !context.mightBeUndefined()
      ) {
        return new StringValue(realm, "[object Function]");
      }
      if (context instanceof AbstractValue && isEnvironmentDerived(context) && realm.generator !== undefined) {
        return AbstractValue.createTemporalFromTemplate(
          realm,
          "global.Object.prototype.toString.call(A)",
          StringValue,
          [context],
          { isPure: true, skipInvariant: true }
        );
      }
      // 1. If the this value is undefined, return "[object Undefined]".
      if (context instanceof UndefinedValue) return new StringValue(realm, "[object Undefined]");

      // 2. If the this value is null, return "[object Null]".
      if (context instanceof NullValue) return new StringValue(realm, "[object Null]");

      // 3. Let O be ToObject(this value).
      let O = To.ToObject(realm, context);

      let builtinTag;

      // 4. Let isArray be ? IsArray(O).
      let isArray = IsArray(realm, O);

      // 5. If isArray is true, let builtinTag be "Array".
      if (isArray) builtinTag = "Array";
      else if (O.$StringData !== undefined)
        // 6. Else, if O is an exotic String object, let builtinTag be "String".
        builtinTag = "String";
      else if (O.$ParameterMap !== undefined)
        // 7. Else, if O has an [[ParameterMap]] internal slot, let builtinTag be "Arguments".
        builtinTag = "Arguments";
      else if (O.$Call !== undefined)
        // 8. Else, if O has a [[Call]] internal method, let builtinTag be "Function".
        builtinTag = "Function";
      else if (O.$ErrorData !== undefined)
        // 9. Else, if O has an [[ErrorData]] internal slot, let builtinTag be "Error".
        builtinTag = "Error";
      else if (O.$BooleanData !== undefined)
        // 10. Else, if O has a [[BooleanData]] internal slot, let builtinTag be "Boolean".
        builtinTag = "Boolean";
      else if (O.$NumberData !== undefined)
        // 11. Else, if O has a [[NumberData]] internal slot, let builtinTag be "Number".
        builtinTag = "Number";
      else if (O.$DateValue !== undefined)
        // 12. Else, if O has a [[DateValue]] internal slot, let builtinTag be "Date".
        builtinTag = "Date";
      else if (O.$RegExpMatcher !== undefined)
        // 13. Else, if O has a [[RegExpMatcher]] internal slot, let builtinTag be "RegExp".
        builtinTag = "RegExp";
      else {
        // 14. Else, let builtinTag be "Object".
        builtinTag = "Object";
      }
      // 15. Let tag be ? Get(O, @@toStringTag).
      let tag = Get(realm, O, realm.intrinsics.SymbolToStringTag);

      // 16. If Type(tag) is not String, let tag be builtinTag.
      tag = tag instanceof StringValue ? tag.value : builtinTag;

      // 17. Return the String that is the result of concatenating "[object ", tag, and "]".
      return new StringValue(realm, `[object ${tag}]`);
    },
    false
  );
  return toStringFn;
}
