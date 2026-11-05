/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import { Effects, type Realm } from "../realm.js";
import type { LexicalEnvironment } from "../environment.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { Value } from "../values/index.js";
import { EmptyValue } from "../values/index.js";
import { UpdateEmpty } from "../methods/index.js";
import { LoopContinues, InternalGetResultValue } from "./ForOfStatement.js";
import {
  AbruptCompletion,
  BreakCompletion,
  Completion,
  ContinueCompletion,
  JoinedAbruptCompletions,
  JoinedNormalAndAbruptCompletions,
  ReturnCompletion,
  SimpleNormalCompletion,
  ThrowCompletion,
} from "../completions.js";
import { Environment, Functions, To, Widen } from "../singletons.js";
import invariant from "../invariant.js";
import { evaluateSpeculatively, residualizeLoop } from "./residualLoop.js";
import type { BabelNodeDoWhileStatement } from "@babel/types";

export default function(
  ast: BabelNodeDoWhileStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  labelSet: ?Array<string>
): Value {
  let { body, test } = ast;

  // 1. Let V be undefined.
  let V = realm.intrinsics.undefined;

  let matchesCurrentLoopContinue = (c: Completion) =>
    c instanceof ContinueCompletion && (!c.target || (labelSet != null && labelSet.indexOf(c.target) >= 0));
  let matchesUnlabeledBreak = (c: Completion) => c instanceof BreakCompletion && !c.target;

  // 2. Repeat
  let resultOrDiagnostic = realm.evaluateWithUndoForDiagnostic(() => {
    let possibleInfiniteLoopIterations = 0;
    while (true) {
      // a. Let stmt be the result of evaluating Statement.
      let stmt = env.evaluateCompletion(body, strictCode);
      invariant(stmt instanceof Value || stmt instanceof AbruptCompletion);

      let result = Functions.incorporateSavedCompletion(realm, stmt);
      invariant(result !== undefined);
      if (result instanceof Value) result = new SimpleNormalCompletion(result);

      // b. If LoopContinues(result, labelSet) is false, return Completion(UpdateEmpty(result, V)).
      if (LoopContinues(realm, result, labelSet) === false) {
        invariant(result instanceof AbruptCompletion);
        // ECMA262 13.1.7
        if (result instanceof BreakCompletion) {
          if (!result.target) return (UpdateEmpty(realm, result, V): any).value;
        } else if (result instanceof JoinedAbruptCompletions && result.containsSelectedCompletion(matchesUnlabeledBreak)) {
          result = Completion.normalizeSelectedCompletions(matchesUnlabeledBreak, result);
        }
        return realm.returnOrThrowCompletion(UpdateEmpty(realm, result, V));
      }

      if (
        (result instanceof JoinedNormalAndAbruptCompletions || result instanceof JoinedAbruptCompletions) &&
        result.containsSelectedCompletion(matchesCurrentLoopContinue)
      ) {
        result = Completion.normalizeSelectedCompletions(matchesCurrentLoopContinue, result);
      }
      invariant(result instanceof Completion);
      result = realm.composeWithSavedCompletion(result);

      // c. If stmt.[[Value]] is not empty, let V be stmt.[[Value]].
      let resultValue = InternalGetResultValue(realm, result);
      if (!(resultValue instanceof EmptyValue)) V = resultValue;

      // d. Let exprRef be the result of evaluating Expression.
      let exprRef = env.evaluate(test, strictCode);

      // e. Let exprValue be ? GetValue(exprRef).
      let exprValue = Environment.GetConditionValue(realm, exprRef);

      // f. If ToBoolean(exprValue) is false, return NormalCompletion(V).
      if (To.ToBooleanPartial(realm, exprValue) === false) {
        let exitCompletion = Functions.incorporateSavedCompletion(realm, V);
        if (
          (exitCompletion instanceof JoinedNormalAndAbruptCompletions ||
            exitCompletion instanceof JoinedAbruptCompletions) &&
          exitCompletion.containsSelectedCompletion(matchesUnlabeledBreak)
        ) {
          exitCompletion = Completion.normalizeSelectedCompletions(matchesUnlabeledBreak, exitCompletion);
        }
        invariant(exitCompletion instanceof Completion || exitCompletion instanceof Value);
        return realm.returnOrThrowCompletion(exitCompletion);
      }

      if (realm.useAbstractInterpretation && realm.savedCompletion !== undefined) {
        possibleInfiniteLoopIterations++;
        if (possibleInfiniteLoopIterations > 6) {
          failIfContainsBreakOrReturnOrThrowCompletion(realm.savedCompletion);
        }
      }
    }
    invariant(false);

    function failIfContainsBreakOrReturnOrThrowCompletion(c: void | Completion | Value) {
      if (c === undefined) return;
      if (c instanceof ThrowCompletion || c instanceof BreakCompletion || c instanceof ReturnCompletion) {
        let diagnostic = new CompilerDiagnostic(
          "break, throw or return cannot be guarded by abstract condition",
          c.location,
          "PP0035",
          "FatalError"
        );
        realm.handleError(diagnostic);
        throw new FatalError();
      }
      if (c instanceof JoinedAbruptCompletions || c instanceof JoinedNormalAndAbruptCompletions) {
        failIfContainsBreakOrReturnOrThrowCompletion(c.consequent);
        failIfContainsBreakOrReturnOrThrowCompletion(c.alternate);
        if (c instanceof JoinedNormalAndAbruptCompletions && c.composedWith !== undefined) {
          failIfContainsBreakOrReturnOrThrowCompletion(c.composedWith);
        }
      }
    }
  });
  if (resultOrDiagnostic instanceof Value) return resultOrDiagnostic;

  // In pure scope, emit the loop as a residual loop rather than trying to summarize it.
  if (realm.isInPureScope() && !realm.instantRender.enabled) {
    return residualizeLoop(
      realm,
      ast,
      strictCode,
      env,
      labelSet,
      `${resultOrDiagnostic.errorCode}: ${resultOrDiagnostic.message}`
    );
  }

  // If we get here then unrolling the loop did not work, possibly because the value of the loop condition is not known,
  // so instead try to compute a fixpoint for it
  let iteration = () => {
    let bodyResult = env.evaluateCompletion(body, strictCode);
    if (bodyResult instanceof Value) bodyResult = new SimpleNormalCompletion(bodyResult);
    let exprRef = env.evaluate(test, strictCode);
    let testResult = Environment.GetConditionValue(realm, exprRef);
    return [testResult, bodyResult];
  };
  let savedWiden = (Widen: any).beginFixpoint();
  let fixpointEffects = evaluateSpeculatively(realm, () =>
    realm.evaluateForEffects(
      () => {
        let result = realm.evaluateForFixpointEffects(iteration);
        if (result === undefined) throw new FatalError("fixpoint failed");
        let [outsideEffects, insideEffects, cond] = result;
        let rval = outsideEffects.result;
        let bodyGenerator = insideEffects.generator;
        realm.applyEffects(outsideEffects);
        let generator = realm.generator;
        invariant(generator !== undefined);
        generator.emitDoWhileStatement(cond, bodyGenerator);
        invariant(rval instanceof SimpleNormalCompletion, "todo: handle loops that throw exceptions or return");
        return rval.value;
      },
      undefined,
      "DoWhileFixpoint"
    )
  );
  let fixpointSucceeded = fixpointEffects instanceof Effects;
  (Widen: any).endFixpoint(savedWiden, fixpointSucceeded);
  if (fixpointSucceeded) {
    invariant(fixpointEffects instanceof Effects);
    realm.applyEffects(fixpointEffects);
    return realm.returnOrThrowCompletion(fixpointEffects.result);
  }

  // If we get here the fixpoint computation failed as well. Fall back to a residual loop if possible.
  if (realm.useAbstractInterpretation && !realm.instantRender.enabled) {
    return residualizeLoop(
      realm,
      ast,
      strictCode,
      env,
      labelSet,
      `${resultOrDiagnostic.errorCode}: ${resultOrDiagnostic.message}`
    );
  }
  realm.handleError(resultOrDiagnostic);
  throw new FatalError();
}
