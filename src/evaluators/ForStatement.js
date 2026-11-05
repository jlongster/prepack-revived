/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { LexicalEnvironment } from "../environment.js";
import { Effects, Realm } from "../realm.js";
import { Value, EmptyValue, type UndefinedValue } from "../values/index.js";
import {
  AbruptCompletion,
  BreakCompletion,
  Completion,
  ContinueCompletion,
  JoinedAbruptCompletions,
  JoinedNormalAndAbruptCompletions,
  ReturnCompletion,
  ThrowCompletion,
  SimpleNormalCompletion,
} from "../completions.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { UpdateEmpty } from "../methods/index.js";
import { LoopContinues, InternalGetResultValue } from "./ForOfStatement.js";
import { Environment, Functions, To } from "../singletons.js";
import { evaluateSpeculatively, residualizeLoop } from "./residualLoop.js";
import invariant from "../invariant.js";
import type { BabelNodeForStatement } from "@babel/types";

// ECMA262 13.7.4.9
export function CreatePerIterationEnvironment(realm: Realm, perIterationBindings: Array<string>): UndefinedValue {
  // 1. If perIterationBindings has any elements, then
  if (perIterationBindings.length > 0) {
    // a. Let lastIterationEnv be the running execution context's LexicalEnvironment.
    let lastIterationEnv = realm.getRunningContext().lexicalEnvironment;
    // b. Let lastIterationEnvRec be lastIterationEnv's EnvironmentRecord.
    let lastIterationEnvRec = lastIterationEnv.environmentRecord;
    // c. Let outer be lastIterationEnv's outer environment reference.
    let outer = lastIterationEnv.parent;
    // d. Assert: outer is not null.
    invariant(outer !== null);
    // e. Let thisIterationEnv be NewDeclarativeEnvironment(outer).
    let thisIterationEnv = Environment.NewDeclarativeEnvironment(realm, outer);
    // f. Let thisIterationEnvRec be thisIterationEnv's EnvironmentRecord.
    realm.onDestroyScope(lastIterationEnv);
    let thisIterationEnvRec = thisIterationEnv.environmentRecord;
    // g. For each element bn of perIterationBindings do,
    for (let bn of perIterationBindings) {
      // i. Perform ! thisIterationEnvRec.CreateMutableBinding(bn, false).
      thisIterationEnvRec.CreateMutableBinding(bn, false);
      // ii. Let lastValue be ? lastIterationEnvRec.GetBindingValue(bn, true).
      let lastValue = lastIterationEnvRec.GetBindingValue(bn, true);
      // iii.Perform thisIterationEnvRec.InitializeBinding(bn, lastValue).
      thisIterationEnvRec.InitializeBinding(bn, lastValue);
    }
    // h. Set the running execution context's LexicalEnvironment to thisIterationEnv.
    realm.getRunningContext().lexicalEnvironment = thisIterationEnv;
  }
  // 2. Return undefined.
  return realm.intrinsics.undefined;
}

// ECMA262 13.7.4.8
function ForBodyEvaluation(
  realm: Realm,
  test,
  increment,
  stmt,
  perIterationBindings: Array<string>,
  labelSet: ?Array<string>,
  strictCode: boolean
): Value {
  // 1. Let V be undefined.
  let V: Value = realm.intrinsics.undefined;

  // 2. Perform ? CreatePerIterationEnvironment(perIterationBindings).
  CreatePerIterationEnvironment(realm, perIterationBindings);
  let env = realm.getRunningContext().lexicalEnvironment;
  let possibleInfiniteLoopIterations = 0;

  // 3. Repeat
  while (true) {
    let result;
    // a. If test is not [empty], then
    if (test) {
      // i. Let testRef be the result of evaluating test.
      let testRef = env.evaluate(test, strictCode);

      // ii. Let testValue be ? GetValue(testRef).
      let testValue = Environment.GetValue(realm, testRef);

      // iii. If ToBoolean(testValue) is false, return NormalCompletion(V).
      if (!To.ToBooleanPartial(realm, testValue)) {
        result = Functions.incorporateSavedCompletion(realm, V);
        if (result instanceof JoinedNormalAndAbruptCompletions) {
          let selector = c => c instanceof BreakCompletion && !c.target;
          result = Completion.normalizeSelectedCompletions(selector, result);
          result = realm.composeWithSavedCompletion(result);
        }
        return V;
      }
    }

    // b. Let result be the result of evaluating stmt.
    result = env.evaluateCompletion(stmt, strictCode);
    invariant(result instanceof Value || result instanceof AbruptCompletion);

    // this is a join point for break and continue completions
    result = Functions.incorporateSavedCompletion(realm, result);
    invariant(result !== undefined);
    if (result instanceof Value) result = new SimpleNormalCompletion(result);

    // c. If LoopContinues(result, labelSet) is false, return Completion(UpdateEmpty(result, V)).
    if (!LoopContinues(realm, result, labelSet)) {
      invariant(result instanceof AbruptCompletion);
      // ECMA262 13.1.7
      if (result instanceof BreakCompletion) {
        if (!result.target) return (UpdateEmpty(realm, result, V): any).value;
      } else if (result instanceof JoinedAbruptCompletions) {
        let selector = c => c instanceof BreakCompletion && !c.target;
        if (result.containsSelectedCompletion(selector)) {
          result = Completion.normalizeSelectedCompletions(selector, result);
        }
      }
      return realm.returnOrThrowCompletion(result);
    }
    if (result instanceof JoinedNormalAndAbruptCompletions) {
      result = Completion.normalizeSelectedCompletions(c => c instanceof ContinueCompletion, result);
    }
    invariant(result instanceof Completion);
    result = realm.composeWithSavedCompletion(result);

    // d. If result.[[Value]] is not empty, let V be result.[[Value]].
    let resultValue = InternalGetResultValue(realm, result);
    if (!(resultValue instanceof EmptyValue)) V = resultValue;

    // e. Perform ? CreatePerIterationEnvironment(perIterationBindings).
    CreatePerIterationEnvironment(realm, perIterationBindings);
    env = realm.getRunningContext().lexicalEnvironment;

    // f. If increment is not [empty], then
    if (increment) {
      // i. Let incRef be the result of evaluating increment.
      let incRef = env.evaluate(increment, strictCode);

      // ii. Perform ? GetValue(incRef).
      Environment.GetValue(realm, incRef);
    } else if (realm.useAbstractInterpretation) {
      // If we have no increment and we've hit 6 iterations of trying to evaluate
      // this loop body, then see if we have a break, return or throw completion in a
      // guarded condition and fail if it does. We already have logic to guard
      // against loops that are actually infinite. However, because there may be so
      // many forked execution paths, and they're non linear, then it might
      // computationally lead to a something that seems like an infinite loop.
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
    }
  }
}

function tryToEvaluateForStatementOrLeaveAsAbstract(
  ast: BabelNodeForStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  labelSet: ?Array<string>
): Value {
  invariant(!realm.instantRender.enabled);
  let effects = evaluateSpeculatively(realm, () =>
    realm.evaluateForEffects(
      () => evaluateForStatement(ast, strictCode, env, realm, labelSet),
      undefined,
      "tryToEvaluateForStatementOrLeaveAsAbstract"
    )
  );
  if (!(effects instanceof Effects)) {
    return residualizeLoop(realm, ast, strictCode, env, labelSet, effects.failure);
  }
  realm.applyEffects(effects);
  return realm.returnOrThrowCompletion(effects.result);
}

// ECMA262 13.7.4.7
export default function(
  ast: BabelNodeForStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  labelSet: ?Array<string>
): Value {
  // Trial iterations created by residualLoop.js must not be residualized themselves.
  if (realm.isInPureScope() && !realm.instantRender.enabled && !(ast: any).prepackTrialLoop) {
    return tryToEvaluateForStatementOrLeaveAsAbstract(ast, strictCode, env, realm, labelSet);
  } else {
    return evaluateForStatement(ast, strictCode, env, realm, labelSet);
  }
}

function evaluateForStatement(
  ast: BabelNodeForStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm,
  labelSet: ?Array<string>
): Value {
  let { init, test, update, body } = ast;

  if (init && init.type === "VariableDeclaration") {
    if (init.kind === "var") {
      // for (var VariableDeclarationList; Expression; Expression) Statement
      // 1. Let varDcl be the result of evaluating VariableDeclarationList.
      let varDcl = env.evaluate(init, strictCode);

      // 2. ReturnIfAbrupt(varDcl).
      varDcl;

      // 3. Return ? ForBodyEvaluation(the first Expression, the second Expression, Statement, « », labelSet).
      return ForBodyEvaluation(realm, test, update, body, [], labelSet, strictCode);
    } else {
      // for (LexicalDeclaration Expression; Expression) Statement
      // 1. Let oldEnv be the running execution context's LexicalEnvironment.
      let oldEnv = env;

      // 2. Let loopEnv be NewDeclarativeEnvironment(oldEnv).
      let loopEnv = Environment.NewDeclarativeEnvironment(realm, oldEnv);

      // 3. Let loopEnvRec be loopEnv's EnvironmentRecord.
      let loopEnvRec = loopEnv.environmentRecord;

      // 4. Let isConst be the result of performing IsConstantDeclaration of LexicalDeclaration.
      let isConst = init.kind === "const";

      // 5. Let boundNames be the BoundNames of LexicalDeclaration.
      let boundNames = Environment.BoundNames(realm, init);

      // 6. For each element dn of boundNames do
      for (let dn of boundNames) {
        // a. If isConst is true, then
        if (isConst) {
          // i. Perform ! loopEnvRec.CreateImmutableBinding(dn, true).
          loopEnvRec.CreateImmutableBinding(dn, true);
        } else {
          // b. Else,
          // i. Perform ! loopEnvRec.CreateMutableBinding(dn, false).
          loopEnvRec.CreateMutableBinding(dn, false);
        }
      }

      // 7. Set the running execution context's LexicalEnvironment to loopEnv.
      realm.getRunningContext().lexicalEnvironment = loopEnv;

      // 8. Let forDcl be the result of evaluating LexicalDeclaration.
      let forDcl = loopEnv.evaluateCompletion(init, strictCode);

      // 9. If forDcl is an abrupt completion, then
      if (forDcl instanceof AbruptCompletion) {
        // a. Set the running execution context's LexicalEnvironment to oldEnv.
        let currentEnv = realm.getRunningContext().lexicalEnvironment;
        realm.onDestroyScope(currentEnv);
        if (currentEnv !== loopEnv) invariant(loopEnv.destroyed);
        realm.getRunningContext().lexicalEnvironment = oldEnv;

        // b. Return Completion(forDcl).
        throw forDcl;
      }

      // 10. If isConst is false, let perIterationLets be boundNames; otherwise let perIterationLets be « ».
      let perIterationLets = !isConst ? boundNames : [];

      let bodyResult;
      try {
        // 11. Let bodyResult be ForBodyEvaluation(the first Expression, the second Expression, Statement, perIterationLets, labelSet).
        bodyResult = ForBodyEvaluation(realm, test, update, body, perIterationLets, labelSet, strictCode);
      } finally {
        // 12. Set the running execution context's LexicalEnvironment to oldEnv.
        let currentEnv = realm.getRunningContext().lexicalEnvironment;
        realm.onDestroyScope(currentEnv);
        if (currentEnv !== loopEnv) invariant(loopEnv.destroyed);
        realm.getRunningContext().lexicalEnvironment = oldEnv;
      }
      // 13. Return Completion(bodyResult).
      return bodyResult;
    }
  } else {
    // for (Expression; Expression; Expression) Statement
    // 1. If the first Expression is present, then
    if (init) {
      // a. Let exprRef be the result of evaluating the first Expression.
      let exprRef = env.evaluate(init, strictCode);

      // b. Perform ? GetValue(exprRef).
      Environment.GetValue(realm, exprRef);
    }

    // 2. Return ? ForBodyEvaluation(the second Expression, the third Expression, Statement, « », labelSet).
    return ForBodyEvaluation(realm, test, update, body, [], labelSet, strictCode);
  }
}
