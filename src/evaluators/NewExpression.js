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
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { ObjectValue, Value, AbstractObjectValue, AbstractValue } from "../values/index.js";
import { Environment, Leak } from "../singletons.js";
import { IsConstructor, ArgumentListEvaluation } from "../methods/index.js";
import { Construct } from "../methods/index.js";
import invariant from "../invariant.js";
import { FatalError } from "../errors.js";
import { BabelNodeNewExpression } from "@babel/types";
import { createOperationDescriptor } from "../utils/generator.js";
import { constructEnvironmentObject } from "../intrinsics/env/models.js";

export default function(
  ast: BabelNodeNewExpression,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): ObjectValue | AbstractObjectValue {
  // ECMA262 12.3.3.1 We just implement this method inline since it's only called here.
  // 1. Return ? EvaluateNew(NewExpression, empty).

  // ECMA262 2.3.3.1.1

  let constructProduction = ast.callee;
  let args = ast.arguments;

  // These steps not necessary due to our AST representation.
  // 1. Assert: constructProduction is either a NewExpression or a MemberExpression.
  // 2. Assert: arguments is either empty or an Arguments production.

  // 3. Let ref be the result of evaluating constructProduction.
  let ref = env.evaluate(constructProduction, strictCode);

  // 4. Let constructor be ? GetValue(ref).
  let constructor = Environment.GetValue(realm, ref);

  let argsList;

  // 5. If arguments is empty, let argList be a new empty List.
  if (!args.length) {
    argsList = [];
  } else {
    // 6. Else,
    // a. Let argList be ArgumentListEvaluation of arguments.
    argsList = ArgumentListEvaluation(realm, strictCode, env, (args: any)); // BabelNodeNewExpression needs updating

    // This step not necessary since we propagate completions with exceptions.
    // b. ReturnIfAbrupt(argList).
  }

  let previousLoc = realm.setNextExecutionContextLocation(ast.loc);
  try {
    // If we are in pure scope, attempt to recover from creating the construct if
    // it fails by creating a temporal abstract
    if (realm.isInPureScope()) {
      return tryToEvaluateConstructOrLeaveAsAbstract(constructor, argsList, strictCode, realm, ref);
    } else {
      return createConstruct(constructor, argsList, realm, ref);
    }
  } finally {
    realm.setNextExecutionContextLocation(previousLoc);
  }
}

function tryToEvaluateConstructOrLeaveAsAbstract(
  constructor: Value,
  argsList: Array<Value>,
  strictCode: boolean,
  realm: Realm,
  ref?: Value | Reference
): ObjectValue | AbstractObjectValue {
  let effects;
  try {
    effects = realm.evaluateForEffects(
      () => createConstruct(constructor, argsList, realm, ref),
      undefined,
      "tryToEvaluateConstructOrLeaveAsAbstract"
    );
  } catch (error) {
    // if a FatalError occurs when constructing the constructor
    // then try and recover and create an abstract for this construct
    if (error instanceof FatalError) {
      // we need to leak all the arguments and the constructor
      Leak.value(realm, constructor);
      for (let arg of argsList) {
        Leak.value(realm, arg);
      }
      let abstractValue = realm.evaluateWithPossibleThrowCompletion(
        () =>
          AbstractValue.createTemporalFromBuildFunction(
            realm,
            ObjectValue,
            [constructor, ...argsList],
            createOperationDescriptor("NEW_EXPRESSION")
          ),
        TypesDomain.topVal,
        ValuesDomain.topVal
      );
      invariant(abstractValue instanceof AbstractObjectValue);
      return abstractValue;
    } else {
      throw error;
    }
  }
  realm.applyEffects(effects);
  let completion = realm.returnOrThrowCompletion(effects.result);
  invariant(completion instanceof ObjectValue || completion instanceof AbstractObjectValue);
  return completion;
}

function createConstruct(
  constructor: Value,
  argsList: Array<Value>,
  realm: Realm,
  ref?: Value | Reference
): ObjectValue | AbstractObjectValue {
  if (constructor instanceof AbstractValue && constructor.kind === "conditional") {
    // Construct each possible constructor under its condition and join the results. A side that is not
    // a constructor (e.g. undefined, see #2561) becomes a conditional TypeError.
    let [condition, consequent, alternate] = constructor.args;
    let result = realm.evaluateWithAbstractConditional(
      condition,
      () =>
        realm.evaluateForEffects(() => createConstruct(consequent, argsList, realm), undefined, "createConstruct/1"),
      () => realm.evaluateForEffects(() => createConstruct(alternate, argsList, realm), undefined, "createConstruct/2")
    );
    invariant(result instanceof ObjectValue || result instanceof AbstractObjectValue);
    return result;
  }
  if (constructor instanceof AbstractValue && constructor.isEnvironmentValue === true) {
    let envConstructor: AbstractValue = constructor;
    let baseObj: void | Value;
    let propName: void | string;
    if (ref instanceof Reference && ref.base instanceof Value && typeof ref.referencedName === "string") {
      baseObj =
        ref.base instanceof AbstractObjectValue && ref.base.kind === "explicit conversion to object"
          ? ref.base.args[0]
          : ref.base;
      propName = ref.referencedName;
    }
    if (realm.isInPureScope()) {
      for (let arg of argsList) Leak.value(realm, arg);
      let constructed = realm.evaluateWithPossibleThrowCompletion(
        () => constructEnvironmentObject(realm, envConstructor, argsList, baseObj, propName),
        TypesDomain.topVal,
        ValuesDomain.topVal
      );
      invariant(constructed instanceof ObjectValue || constructed instanceof AbstractObjectValue);
      return constructed;
    }
    return constructEnvironmentObject(realm, envConstructor, argsList, baseObj, propName);
  }
  // 7. If IsConstructor(constructor) is false, throw a TypeError exception.
  if (IsConstructor(realm, constructor) === false) {
    throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError);
  }
  invariant(constructor instanceof ObjectValue);

  // 8. Return ? Construct(constructor, argList).
  return Construct(realm, constructor, argsList);
}
