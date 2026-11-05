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
import {
  type Binding,
  DeclarativeEnvironmentRecord,
  EnvironmentRecord,
  GlobalEnvironmentRecord,
  type LexicalEnvironment,
  leakBinding,
} from "../environment.js";
import {
  AbruptCompletion,
  Completion,
  JoinedAbruptCompletions,
  JoinedNormalAndAbruptCompletions,
  SimpleNormalCompletion,
  ThrowCompletion,
} from "../completions.js";
import { PropertyDescriptor } from "../descriptors.js";
import { TestIntegrityLevel, UpdateEmpty } from "../methods/index.js";
import { CompilerDiagnostic, FatalError, InfeasiblePathError } from "../errors.js";
import { construct_empty_effects, Effects } from "../realm.js";
import { Join, Leak, Path } from "../singletons.js";
import { AbstractValue, EmptyValue, NumberValue, ObjectValue, Value } from "../values/index.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { createOperationDescriptor, Generator } from "../utils/generator.js";
import type {
  BabelNodeBlockStatement,
  BabelNodeCatchClause,
  BabelNodeSourceLocation,
  BabelNodeTryStatement,
} from "@babel/types";
import invariant from "../invariant.js";

export default function(ast: BabelNodeTryStatement, strictCode: boolean, env: LexicalEnvironment, realm: Realm): Value {
  if (realm.useAbstractInterpretation) return joinTryBlockWithHandlers(ast, strictCode, env, realm);

  let blockRes = env.evaluateCompletionDeref(ast.block, strictCode);
  let result = blockRes;

  if (blockRes instanceof ThrowCompletion && ast.handler) {
    result = env.evaluateCompletionDeref(ast.handler, strictCode, blockRes);
  }

  if (ast.finalizer) {
    result = composeResults(result, env.evaluateCompletionDeref(ast.finalizer, strictCode));
  }

  return realm.returnOrThrowCompletion(UpdateEmpty(realm, result, realm.intrinsics.undefined));
}

function composeResults(r1: Completion | Value, r2: Completion | Value): Completion | Value {
  if (r2 instanceof AbruptCompletion) return r2;
  return Join.composeCompletions(r2, r1);
}

function joinTryBlockWithHandlers(
  ast: BabelNodeTryStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  let finalizer = ast.finalizer;
  if (!finalizer) {
    return joinTryAndCatch(ast.block, ast.handler, ast.loc, strictCode, env, realm);
  }
  // Desugar `try B catch (e) H finally F` into `try { try B catch (e) H } finally F` so that both modeled and
  // unmodeled throws from `H` still execute `F` before propagating.
  let evalTryPart = ast.handler
    ? () => joinTryAndCatch(ast.block, ast.handler, ast.loc, strictCode, env, realm)
    : () => env.evaluateCompletionDeref(ast.block, strictCode);
  return joinTryAndFinally(evalTryPart, finalizer, ast.loc, strictCode, env, realm);
}

function joinTryAndCatch(
  block: BabelNodeBlockStatement,
  handler: ?BabelNodeCatchClause,
  loc: ?BabelNodeSourceLocation,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  let blockRes;
  if (realm.isInPureScope()) {
    let firstNewEnvironmentId = EnvironmentRecord.nextId;
    let evalBlock = () => env.evaluateCompletionDeref(block, strictCode);
    let [blockEffects, unmodeledThrows] = evaluateTryBlockForEffects(evalBlock, realm);
    if (unmodeledThrows > 0) {
      let result = emitResidualTryStatement(
        evalBlock,
        handler,
        loc,
        strictCode,
        env,
        realm,
        blockEffects,
        firstNewEnvironmentId
      );
      return realm.returnOrThrowCompletion(UpdateEmpty(realm, result, realm.intrinsics.undefined));
    }
    realm.applyEffects(blockEffects);
    blockRes = blockEffects.result;
    if (blockRes instanceof SimpleNormalCompletion) blockRes = blockRes.value;
  } else {
    // The end of the try block is a join point for the (conditional) abrupt completions that arise inside it.
    // Abrupt completions saved before the try statement was reached must not be seen by the handler.
    blockRes = realm.evaluateCompletionInSavedCompletionScope(() => env.evaluateCompletionDeref(block, strictCode));
  }

  let result = blockRes;
  let selector = c => c instanceof ThrowCompletion;
  if (handler && blockRes instanceof Completion && blockRes.containsSelectedCompletion(selector)) {
    if (blockRes instanceof ThrowCompletion) {
      result = realm.evaluateCompletionInSavedCompletionScope(() =>
        env.evaluateCompletionDeref(handler, strictCode, blockRes)
      );
    } else {
      invariant(blockRes instanceof JoinedAbruptCompletions || blockRes instanceof JoinedNormalAndAbruptCompletions);
      // put the handler under a guard that excludes normal paths from entering it.
      let joinCondition = AbstractValue.createJoinConditionForSelectedCompletions(selector, blockRes);
      if (joinCondition.mightNotBeFalse()) {
        try {
          let handlerEffects = Path.withCondition(joinCondition, () => {
            invariant(blockRes instanceof Completion);
            let joinedThrow = new ThrowCompletion(Join.joinValuesOfSelectedCompletions(selector, blockRes));
            let handlerEval = () => env.evaluateCompletionDeref(handler, strictCode, joinedThrow);
            return realm.evaluateForEffects(handlerEval, undefined, "joinTryBlockWithHandlers");
          });
          Completion.makeSelectedCompletionsInfeasible(selector, blockRes);
          let emptyEffects = construct_empty_effects(realm, blockRes);
          handlerEffects = Join.joinEffects(joinCondition, handlerEffects, emptyEffects);
          realm.applyEffects(handlerEffects);
          result = handlerEffects.result;
        } catch (e) {
          if (!(e instanceof InfeasiblePathError)) throw e;
          // It turns out that the handler is not reachable after all so just do nothing and carry on
        }
      }
    }
  }

  return realm.returnOrThrowCompletion(UpdateEmpty(realm, result, realm.intrinsics.undefined));
}

function joinTryAndFinally(
  evalTryPart: () => Completion | Value,
  finalizer: BabelNodeBlockStatement,
  loc: ?BabelNodeSourceLocation,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  let result;
  if (realm.isInPureScope()) {
    let firstNewEnvironmentId = EnvironmentRecord.nextId;
    let [blockEffects, unmodeledThrows] = evaluateTryBlockForEffects(evalTryPart, realm);
    if (unmodeledThrows > 0) {
      result = emitResidualTryStatement(
        evalTryPart,
        null,
        loc,
        strictCode,
        env,
        realm,
        blockEffects,
        firstNewEnvironmentId
      );
    } else {
      realm.applyEffects(blockEffects);
      result = blockEffects.result;
      if (result instanceof SimpleNormalCompletion) result = result.value;
    }
  } else {
    result = realm.evaluateCompletionInSavedCompletionScope(evalTryPart);
  }

  let finRes = realm.evaluateCompletionInSavedCompletionScope(() => env.evaluateCompletionDeref(finalizer, strictCode));
  result = composeResults(result, finRes);
  return realm.returnOrThrowCompletion(UpdateEmpty(realm, result, realm.intrinsics.undefined));
}

// Evaluates the try block, counting the operations in it that might throw exceptions that Prepack does not model.
function evaluateTryBlockForEffects(evalBlock: () => Completion | Value, realm: Realm): [Effects, number] {
  let savedIsInPureTryStatement = realm.isInPureTryStatement;
  let savedUnmodeledThrows = realm.unmodeledThrowsInPureTry;
  realm.isInPureTryStatement = true;
  realm.unmodeledThrowsInPureTry = 0;
  try {
    let effects = realm.evaluateForEffects(evalBlock, undefined, "evaluateTryBlockForEffects");
    let unmodeledThrows = realm.unmodeledThrowsInPureTry;
    invariant(unmodeledThrows !== undefined);
    return [effects, unmodeledThrows];
  } finally {
    realm.isInPureTryStatement = savedIsInPureTryStatement;
    realm.unmodeledThrowsInPureTry = savedUnmodeledThrows;
  }
}

function canLeakBindingInPureTry(realm: Realm, binding: Binding): boolean {
  let envRec = binding.environment;
  return (
    envRec instanceof DeclarativeEnvironmentRecord &&
    !(envRec instanceof GlobalEnvironmentRecord) &&
    envRec.creatingOptimizedFunction === realm.currentOptimizedFunction &&
    binding.initialized === true
  );
}

function canLeakObjectInPureTry(realm: Realm, object: ObjectValue): boolean {
  if (!object.mightNotBeLeakedObject()) return true;
  if (TestIntegrityLevel(realm, object, "frozen")) return true;
  let tracked = realm.createdObjectsTrackedForLeaks;
  if (tracked === undefined || !tracked.has(object)) return false;
  if (object.symbols.size > 0) return false;
  for (let [, propertyBinding] of object.properties) {
    let desc = propertyBinding.descriptor;
    if (desc !== undefined && !(desc instanceof PropertyDescriptor)) return false;
  }
  return true;
}

// The try block contains operations that might throw exceptions that Prepack does not model, such as calls to
// unknown functions. Emit its code inside a residual try statement that captures the exception (if any), and
// then evaluate the handler (or, for try/finally, a rethrow) under the residual condition that an exception was
// caught. Since the exception might be thrown at any point of the block, the handler cannot know the state of
// bindings and objects modified by the block. These are therefore leaked before the block, so that all
// modifications are emitted as residual code in order, and the handler reads their actual values.
function emitResidualTryStatement(
  evalBlock: () => Completion | Value,
  handler: ?BabelNodeCatchClause,
  loc: ?BabelNodeSourceLocation,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  probeEffects: Effects,
  firstNewEnvironmentId: number
): Completion | Value {
  let bindings = new Set();
  let objects = new Set();
  addPreexistingModifiedState(probeEffects, firstNewEnvironmentId, bindings, objects);
  if (bindings.size === 0 && objects.size === 0) {
    return emitResidualTryStatementForBlockEffects(handler, loc, strictCode, env, realm, probeEffects);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    let stateSize = bindings.size + objects.size;
    let canLeakAll = true;
    for (let binding of bindings) {
      if (!canLeakBindingInPureTry(realm, binding)) canLeakAll = false;
    }
    for (let object of objects) {
      if (!canLeakObjectInPureTry(realm, object)) canLeakAll = false;
    }
    if (!canLeakAll) break;
    let blockEffects;
    let allLeaked = true;
    let leakEffects;
    try {
      leakEffects = realm.evaluateForEffects(
        () => {
          for (let binding of bindings) leakBinding(binding);
          for (let object of objects) {
            Leak.value(realm, object);
            if (object.mightNotBeLeakedObject() && !TestIntegrityLevel(realm, object, "frozen")) allLeaked = false;
          }
          if (allLeaked) [blockEffects] = evaluateTryBlockForEffects(evalBlock, realm);
          return realm.intrinsics.undefined;
        },
        undefined,
        "emitResidualTryStatement/leak"
      );
    } catch (e) {
      if (!(e instanceof FatalError)) throw e;
      allLeaked = false;
    }
    if (!allLeaked || leakEffects === undefined) break;
    invariant(blockEffects !== undefined);
    addPreexistingModifiedState(blockEffects, firstNewEnvironmentId, bindings, objects);
    if (bindings.size + objects.size === stateSize) {
      realm.applyEffects(leakEffects);
      return emitResidualTryStatementForBlockEffects(handler, loc, strictCode, env, realm, blockEffects);
    }
  }
  let diag = new CompilerDiagnostic(
    "Possible throw inside try/catch is not yet supported",
    loc,
    "PP0021",
    "RecoverableError"
  );
  if (realm.handleError(diag) !== "Recover") throw new FatalError();
  // Recover by ignoring the possibility of exceptions that Prepack does not model.
  realm.applyEffects(probeEffects);
  return probeEffects.result;
}

function addPreexistingModifiedState(
  effects: Effects,
  firstNewEnvironmentId: number,
  bindings: Set<Binding>,
  objects: Set<ObjectValue>
): void {
  effects.modifiedBindings.forEach((entry, binding) => {
    if (binding.environment.id < firstNewEnvironmentId) bindings.add(binding);
  });
  effects.modifiedProperties.forEach((desc, propertyBinding) => {
    let object = propertyBinding.object;
    if (object instanceof ObjectValue && !effects.createdObjects.has(object)) objects.add(object);
  });
}

function emitResidualTryStatementForBlockEffects(
  handler: ?BabelNodeCatchClause,
  loc: ?BabelNodeSourceLocation,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  blockEffects: Effects
): Completion | Value {
  let bottom = realm.intrinsics.__bottomValue;
  let throwSelector = c => c instanceof ThrowCompletion && c.value !== bottom && !(c.value instanceof EmptyValue);
  let blockGenerator = blockEffects.generator;
  let blockResult = blockEffects.result;
  let blockCanCompleteWithoutThrow = true;
  // Throws that Prepack does model are emitted as residual throw statements, so that the residual try statement
  // catches them too.
  if (blockResult instanceof ThrowCompletion) {
    blockGenerator.emitThrow(blockResult.value);
    blockCanCompleteWithoutThrow = false;
  } else if (
    (blockResult instanceof JoinedAbruptCompletions || blockResult instanceof JoinedNormalAndAbruptCompletions) &&
    blockResult.containsSelectedCompletion(throwSelector)
  ) {
    blockGenerator.emitConditionalThrow(Join.joinValuesOfSelectedCompletions(throwSelector, blockResult, true));
    blockResult = Completion.makeSelectedCompletionsInfeasibleInCopy(throwSelector, blockResult);
    if (blockResult.value === bottom) blockCanCompleteWithoutThrow = false;
  }

  let generator = realm.generator;
  invariant(generator !== undefined);
  let caught = generator.emitTryCatch(blockGenerator);
  let threw = AbstractValue.createFromBinaryOp(realm, "!==", caught, realm.intrinsics.undefined);
  invariant(threw instanceof AbstractValue);
  let handlerEffects = Path.withCondition(threw, () =>
    realm.evaluateForEffects(
      () => {
        let handlerGenerator = realm.generator;
        invariant(handlerGenerator !== undefined);
        let exception = handlerGenerator.deriveAbstract(
          TypesDomain.topVal,
          ValuesDomain.topVal,
          [caught, new NumberValue(realm, 0)],
          createOperationDescriptor("ABSTRACT_PROPERTY"),
          { isPure: true, skipInvariant: true }
        );
        let thrown = new ThrowCompletion(exception, loc);
        if (!handler) return thrown; // try/finally: rethrow after the finalizer
        return env.evaluateCompletionDeref(handler, strictCode, thrown);
      },
      undefined,
      "emitResidualTryStatement/handler"
    )
  );
  let effects = handlerEffects;
  if (blockCanCompleteWithoutThrow) {
    let blockPostEffects = new Effects(
      blockResult,
      new Generator(realm, "emitResidualTryStatement/block", realm.pathConditions),
      blockEffects.modifiedBindings,
      blockEffects.modifiedProperties,
      blockEffects.createdObjects,
      blockEffects.createdAbstracts
    );
    effects = Join.joinEffects(threw, handlerEffects, blockPostEffects);
  }
  realm.applyEffects(effects);
  let result = effects.result;
  return result instanceof SimpleNormalCompletion ? result.value : result;
}
