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
import { AbruptCompletion } from "../completions.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { Value, ObjectValue, UndefinedValue } from "../values/index.js";
import { Create } from "../singletons.js";
import invariant from "../invariant.js";
import type { BabelNodeBlockStatement } from "@babel/types";

// ECMA26225.3.3.1
export function GeneratorStart(
  realm: Realm,
  generator: ObjectValue,
  generatorBody: BabelNodeBlockStatement
): UndefinedValue {
  // Note that generator is a new object, and we can thus write to internal slots
  invariant(realm.isNewObject(generator));

  // 1. Assert: The value of generator.[[GeneratorState]] is undefined.
  invariant(
    generator instanceof ObjectValue && generator.$GeneratorState === undefined,
    "The value of generator.[[GeneratorState]] is undefined"
  );

  // 2. Let genContext be the running execution context.
  let genContext = realm.getRunningContext();

  // 3. Set the Generator component of genContext to generator.

  // 4. Set the code evaluation state of genContext such that when evaluation is resumed for that execution context the following steps will be performed:
  // a. Let result be the result of evaluating generatorBody.
  // b. Assert: If we return here, the generator either threw an exception or performed either an implicit or explicit return.
  // c. Remove genContext from the execution context stack and restore the execution context that is at the top of the execution context stack as the running execution context.
  // d. Set generator.[[GeneratorState]] to "completed".
  // e. Once a generator enters the "completed" state it never leaves it and its associated execution context is never resumed. Any execution state associated with generator can be discarded at this point.
  // f. If result is a normal completion, let resultValue be undefined.
  // g. Else,
  // i. If result.[[Type]] is return, let resultValue be result.[[Value]].
  // ii. Else, return Completion(result).
  // h. Return CreateIterResultObject(resultValue, true).

  // 5. Set generator.[[GeneratorContext]] to genContext.
  generator.$GeneratorContext = genContext;

  // 6. Set generator.[[GeneratorState]] to "suspendedStart".
  generator.$GeneratorState = "suspendedStart";

  // 7. Return NormalCompletion(undefined).
  return realm.intrinsics.undefined;
}

// ECMA26225.3.3.2
export function GeneratorValidate(realm: Realm, generator: Value): void | "suspendedStart" {
  // 1. If Type(generator) is not Object, throw a TypeError exception.
  if (!(generator instanceof ObjectValue)) {
    throw realm.createErrorThrowCompletion(realm.intrinsics.SyntaxError, "Type(generator) is not Object");
  }

  // 2. If generator does not have a [[GeneratorState]] internal slot, throw a TypeError exception.
  if (!("$GeneratorState" in generator)) {
    throw realm.createErrorThrowCompletion(realm.intrinsics.SyntaxError, "Type(generator) is not Object");
  }

  // 3. Assert: generator also has a [[GeneratorContext]] internal slot.
  invariant("$GeneratorContext" in generator);

  // 4. Let state be generator.[[GeneratorState]].
  let state = generator.$GeneratorState;

  // 5. If state is "executing", throw a TypeError exception.
  if (state === "executing") {
    throw realm.createErrorThrowCompletion(realm.intrinsics.SyntaxError, "Type(generator) is not Object");
  }

  // 6. Return state.
  return state;
}

// ECMA26225.3.3.3
export function GeneratorResume(realm: Realm, generator: Value, value: Value): Value {
  // 1. Let state be ? GeneratorValidate(generator).
  let state = GeneratorValidate(realm, generator);
  invariant(generator instanceof ObjectValue);

  // 2. If state is "completed", return CreateIterResultObject(undefined, true).
  if (state === "completed") return Create.CreateIterResultObject(realm, realm.intrinsics.undefined, true);

  // 3. Assert: state is either "suspendedStart" or "suspendedYield".
  invariant(
    state === "suspendedStart" || state === "suspendedYield",
    "state is either 'suspendedStart' or 'suspendedYield'"
  );

  let diag = new CompilerDiagnostic(
    "Resuming a generator during initialization is not yet supported",
    realm.currentLocation,
    "PP0001",
    "FatalError"
  );
  realm.handleError(diag);
  throw new FatalError();
}

// ECMA26225.3.3.4
export function GeneratorResumeAbrupt(realm: Realm, generator: Value, abruptCompletion: AbruptCompletion): Value {
  let diag = new CompilerDiagnostic(
    "Resuming a generator during initialization is not yet supported",
    realm.currentLocation,
    "PP0001",
    "FatalError"
  );
  realm.handleError(diag);
  throw new FatalError();
}

// ECMA26225.3.3.5
export function GeneratorYield(realm: Realm, iterNextObj: ObjectValue): Value {
  // 1. Assert: iterNextObj is an Object that implements the IteratorResult interface.

  // 2. Let genContext be the running execution context.
  // 3. Assert: genContext is the execution context of a generator.
  // 4. Let generator be the value of the Generator component of genContext.
  // 5. Set generator.[[GeneratorState]] to "suspendedYield".
  // 6. Remove genContext from the execution context stack and restore the execution context that is at the top of the execution context stack as the running execution context.
  // 7. Set the code evaluation state of genContext such that when evaluation is resumed with a Completion resumptionValue the following steps will be performed:
  // a.  Return resumptionValue.
  // b. NOTE: This returns to the evaluation of the YieldExpression production that originally called this abstract operation.
  // 8. Return NormalCompletion(iterNextObj).
  return realm.intrinsics.undefined;

  // 9. NOTE: This returns to the evaluation of the operation that had most previously resumed evaluation of genContext.
}
