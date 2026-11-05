/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

/*
 * Residual loops for loops whose trip count is unknown at build time (pure scope only).
 *
 * The loop statement is emitted verbatim inside a residual closure that is called once, at the point in time where
 * the loop runs. Every binding the closure refers to and every object reachable from them that was created in the
 * current pure scope is leaked (materialized) first, so the loop runs against the real runtime state and everything
 * after the loop reads that state back residually.
 *
 * Leaking only covers state created in the current pure scope. To make sure the loop cannot touch anything else, one
 * abstract iteration of the loop is evaluated against the leaked state (all loop-carried bindings and leaked object
 * properties are unknown there, so it covers every iteration). If that trial modifies any binding or property that
 * is neither leaked nor created by the trial itself, the loop is rejected with a diagnostic.
 *
 * Exits out of the loop that the closure cannot express directly (return, and break/continue to labels outside the
 * loop) are encoded as a numeric result of the closure; the completion is then rebuilt after the call.
 */

import { EnvironmentRecord, type LexicalEnvironment } from "../environment.js";
import { Effects, type Realm } from "../realm.js";
import {
  ECMAScriptSourceFunctionValue,
  NumberValue,
  ObjectValue,
  StringValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import {
  AbruptCompletion,
  Completion,
  SimpleNormalCompletion,
  JoinedAbruptCompletions,
  JoinedNormalAndAbruptCompletions,
} from "../completions.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { Call } from "../methods/call.js";
import { Environment, Functions, Leak } from "../singletons.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { AbstractValue } from "../values/index.js";
import { createOperationDescriptor } from "../utils/generator.js";
import invariant from "../invariant.js";
import traverse from "@babel/traverse";
import type { BabelTraversePath } from "@babel/traverse";
import * as t from "@babel/types";
import type {
  BabelNode,
  BabelNodeBlockStatement,
  BabelNodeExpression,
  BabelNodeStatement,
  BabelNodeLVal,
  BabelNodeSourceLocation,
} from "@babel/types";

const VALUE_NAME = "__prepack_loop_value";
const ARGUMENTS_NAME = "__prepack_loop_arguments";
const CODE_NAME = "__prepack_loop_exit";
const KEY_NAME = "__prepack_loop_key";
const ONCE_NAME = "__prepack_loop_once";

type LoopExit = { kind: "break" | "continue", label: string };

type TransformState = {
  root: BabelNode,
  usesThis: boolean,
  usesArguments: boolean,
  usesReturn: boolean,
  exits: Array<LoopExit>,
  unsupported: void | string,
};

function nearestFunction(path: BabelTraversePath, includeArrows: boolean): void | BabelNode {
  let p = path.findParent(q => q.isFunction() && (includeArrows || !q.isArrowFunctionExpression()));
  return p ? p.node : undefined;
}

function hasEnclosingLabel(path: BabelTraversePath, label: string, root: BabelNode): boolean {
  let p = path.parentPath;
  while (p && p.node !== root) {
    if (p.isLabeledStatement() && p.node.label.name === label) return true;
    p = p.parentPath;
  }
  return false;
}

function exitCode(state: TransformState, kind: "break" | "continue", label: string): number {
  let i = state.exits.findIndex(e => e.kind === kind && e.label === label);
  if (i < 0) {
    i = state.exits.length;
    state.exits.push({ kind, label });
  }
  return i + 2;
}

function markExit(node: any) {
  node.prepackLoopExit = true;
  return node;
}

function convertDeclarators(declarators: Array<any>): Array<BabelNodeExpression> {
  // `var x;` does not reset x on each iteration, so declarators without initializer are dropped.
  return declarators
    .filter(d => d.init != null)
    .map(d => ((t.assignmentExpression("=", d.id, d.init): any): BabelNodeExpression));
}

let LoopTransformVisitor = {
  ThisExpression(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, false) === state.root) state.usesThis = true;
  },
  ReferencedIdentifier(path: BabelTraversePath, state: TransformState) {
    let name = path.node.name;
    if (
      name === VALUE_NAME ||
      name === ARGUMENTS_NAME ||
      name === CODE_NAME ||
      name === KEY_NAME ||
      name === ONCE_NAME
    ) {
      state.unsupported = `the loop uses the reserved name ${name}`;
    } else if (name === "arguments" && nearestFunction(path, false) === state.root) {
      state.usesArguments = true;
      path.replaceWith(t.identifier(ARGUMENTS_NAME));
    }
  },
  MetaProperty(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, false) === state.root) state.unsupported = "the loop uses new.target";
  },
  ReturnStatement(path: BabelTraversePath, state: TransformState) {
    if (path.node.prepackLoopExit || nearestFunction(path, true) !== state.root) return;
    state.usesReturn = true;
    let arg = path.node.argument || t.identifier("undefined");
    path.replaceWith(
      markExit(
        t.returnStatement(
          t.sequenceExpression([t.assignmentExpression("=", t.identifier(VALUE_NAME), arg), t.numericLiteral(1)])
        )
      )
    );
    path.skip();
  },
  "BreakStatement|ContinueStatement"(path: BabelTraversePath, state: TransformState) {
    let label = path.node.label;
    if (label == null || nearestFunction(path, true) !== state.root) return;
    if (hasEnclosingLabel(path, label.name, state.root)) return;
    let kind = path.isBreakStatement() ? "break" : "continue";
    path.replaceWith(markExit(t.returnStatement(t.numericLiteral(exitCode(state, kind, label.name)))));
    path.skip();
  },
  FunctionDeclaration(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, true) === state.root) state.unsupported = "the loop body contains a function declaration";
  },
  VariableDeclaration(path: BabelTraversePath, state: TransformState) {
    let node = path.node;
    // The loop is moved into a closure of its own, so `var`s must become assignments to the enclosing bindings.
    // `let` and `const` are block scoped and can stay.
    if (node.kind !== "var" || nearestFunction(path, true) !== state.root) return;
    let parent = path.parentPath.node;
    if ((t.isForInStatement(parent) || t.isForOfStatement(parent)) && parent.left === node) {
      invariant(node.declarations.length === 1);
      if (node.declarations[0].init != null) {
        state.unsupported = "for-in/of with an initializer";
        return;
      }
      path.replaceWith(node.declarations[0].id);
      return;
    }
    let expressions = convertDeclarators(node.declarations);
    let expr =
      expressions.length === 0 ? null : expressions.length === 1 ? expressions[0] : t.sequenceExpression(expressions);
    if (t.isForStatement(parent) && parent.init === node) {
      if (expr === null) path.remove();
      else path.replaceWith(expr);
    } else if (expr === null) {
      path.replaceWith(t.emptyStatement());
    } else {
      path.replaceWith(t.expressionStatement(expr));
    }
  },
};

type TransformedLoop = {
  state: TransformState,
  loop: BabelNodeStatement, // the transformed loop statement (without labels)
  labeled: BabelNodeStatement, // the transformed loop statement, wrapped in its own labels
};

function transformLoop(ast: BabelNodeStatement, labelSet: ?Array<string>): TransformedLoop {
  let labeled: BabelNodeStatement = (t.cloneDeep(ast): any);
  for (let label of (labelSet || []).slice().reverse()) labeled = t.labeledStatement(t.identifier(label), labeled);
  let body = t.blockStatement([labeled]);
  let root = t.functionExpression(null, [], body);
  let state = {
    root,
    usesThis: false,
    usesArguments: false,
    usesReturn: false,
    exits: [],
    unsupported: undefined,
  };
  traverse(t.file(t.program([t.expressionStatement(root)])), LoopTransformVisitor, null, state);
  traverse.cache.clear();
  labeled = body.body[0];
  let loop = labeled;
  while (t.isLabeledStatement(loop)) loop = (loop: any).body;
  return { state, loop, labeled };
}

function withLabels(stmt: BabelNodeStatement, labelSet: ?Array<string>): BabelNodeStatement {
  for (let label of (labelSet || []).slice().reverse()) stmt = t.labeledStatement(t.identifier(label), stmt);
  return stmt;
}

// One iteration of the loop. `break` and `continue` that target the loop end the iteration. The iteration is
// expressed as a for statement that runs once and that is never residualized itself (see ForStatement.js).
function makeTrialBody(loop: BabelNodeStatement, labelSet: ?Array<string>): BabelNodeBlockStatement {
  let n: any = t.cloneDeep(loop);
  let once = body => {
    let flag = t.identifier(ONCE_NAME);
    let node: any = t.forStatement(
      t.variableDeclaration("let", [t.variableDeclarator(flag, t.booleanLiteral(true))]),
      flag,
      t.assignmentExpression("=", t.identifier(ONCE_NAME), t.booleanLiteral(false)),
      body
    );
    node.prepackTrialLoop = true;
    return withLabels(node, labelSet);
  };
  let stmts = [];
  if (n.type === "ForStatement") {
    if (n.init) stmts.push(t.isExpression(n.init) ? t.expressionStatement(n.init) : n.init);
    let iteration = n.test
      ? t.blockStatement([t.ifStatement(t.unaryExpression("!", n.test), t.breakStatement()), n.body])
      : n.body;
    stmts.push(once(iteration));
    if (n.update) stmts.push(t.expressionStatement(n.update));
  } else if (n.type === "WhileStatement") {
    stmts.push(once(t.blockStatement([t.ifStatement(t.unaryExpression("!", n.test), t.breakStatement()), n.body])));
  } else if (n.type === "DoWhileStatement") {
    stmts.push(once(n.body));
    stmts.push(t.expressionStatement(n.test));
  } else {
    invariant(n.type === "ForInStatement" || n.type === "ForOfStatement");
    let left = n.left;
    let assign;
    if (t.isVariableDeclaration(left)) {
      // let/const: a fresh binding per iteration
      assign = t.variableDeclaration(left.kind, [
        t.variableDeclarator(left.declarations[0].id, t.identifier(KEY_NAME)),
      ]);
    } else {
      assign = t.expressionStatement(t.assignmentExpression("=", (left: BabelNodeLVal), t.identifier(KEY_NAME)));
    }
    stmts.push(t.expressionStatement(n.right));
    stmts.push(once(t.blockStatement([assign, n.body])));
  }
  stmts.push(t.returnStatement(t.numericLiteral(0)));
  return t.blockStatement(stmts);
}

function fail(realm: Realm, message: string, loc: ?BabelNodeSourceLocation): empty {
  let diagnostic = new CompilerDiagnostic(
    `failed to emit a residual loop: ${message}`,
    loc || realm.currentLocation,
    "PP0037",
    "FatalError"
  );
  realm.handleError(diagnostic);
  throw new FatalError();
}

// Runs f with all error diagnostics captured instead of reported. Returns the first error message seen (if f fails).
export function evaluateSpeculatively<T>(realm: Realm, f: () => T): T | { failure: string } {
  let savedHandler = realm.errorHandler;
  let savedSuppress = realm.suppressDiagnostics;
  let firstMessage;
  realm.errorHandler = d => {
    if (process.env.PP_LOOP_DEBUG) console.log("speculative diagnostic", d.errorCode, d.message, new Error().stack);
    if (d.severity === "Information" || d.severity === "Warning") return "Recover";
    if (firstMessage === undefined) {
      firstMessage = `${d.errorCode}: ${d.message || "operation not supported on an abstract value"}`;
    }
    return "Fail";
  };
  // Keep messages: they are not printed anyway and help to explain why a loop could not be handled.
  realm.suppressDiagnostics = false;
  try {
    return f();
  } catch (e) {
    if (!(e instanceof FatalError)) throw e;
    if (process.env.PP_LOOP_DEBUG) console.log("speculative failure", e.stack);
    let ownMessage = e.message && e.message !== new FatalError().message ? e.message : undefined;
    return { failure: ownMessage || firstMessage || "unknown reason" };
  } finally {
    realm.errorHandler = savedHandler;
    realm.suppressDiagnostics = savedSuppress;
  }
}

function describeBinding(binding: any): string {
  return typeof binding.name === "string" ? binding.name : "?";
}

function describeProperty(pb: any): string {
  let key = pb.key;
  let k = typeof key === "string" ? key : key instanceof Value ? key.toDisplayString() : "?";
  return `property ${k} of ${pb.object.intrinsicName || "an object"}`;
}

// Checks that the trial iteration only modified leaked state or state it created itself.
function checkTrialEffects(realm: Realm, effects: Effects, firstEnvId: number): void | string {
  let created: Set<ObjectValue> = new Set();
  let all: Array<Effects> = [];
  let visited = new Set();
  let visitCompletion = (c: any) => {
    if (c === undefined || visited.has(c)) return;
    visited.add(c);
    if (c instanceof JoinedNormalAndAbruptCompletions) {
      if (c.savedEffects !== undefined) visitEffects(c.savedEffects);
      visitCompletion(c.composedWith);
    }
    if (c instanceof JoinedNormalAndAbruptCompletions || c instanceof JoinedAbruptCompletions) {
      visitCompletion(c.consequent);
      visitCompletion(c.alternate);
    }
  };
  let visitEffects = (e: Effects) => {
    if (visited.has(e)) return;
    visited.add(e);
    all.push(e);
    for (let o of e.createdObjects) created.add(o);
    visitCompletion(e.result);
  };
  visitEffects(effects);
  for (let e of all) {
    for (let [binding, entry] of e.modifiedBindings) {
      if (binding.hasLeaked && entry.hasLeaked) continue;
      if (binding.environment.id >= firstEnvId) continue; // a scope that was entered by the trial
      return `the loop modifies ${describeBinding(binding)}, which is not local to the optimized function`;
    }
    for (let pb of e.modifiedProperties.keys()) {
      if (created.has(pb.object)) continue;
      if (pb.object.intrinsicName === "__checkedBindings") continue; // internal bookkeeping for invariants
      return `the loop may modify ${describeProperty(
        pb
      )}, which was not created by the optimized function or is not tracked`;
    }
  }
  return undefined;
}

// The initializer of a for statement runs exactly once, before the loop. Evaluate it here if possible, so that the
// loop starts out with known values and the residual loop does not need to contain it.
function evaluateForInit(
  realm: Realm,
  ast: BabelNodeStatement,
  strictCode: boolean,
  env: LexicalEnvironment
): BabelNodeStatement {
  if (ast.type !== "ForStatement") return ast;
  let init = ast.init;
  if (init == null || (init.type === "VariableDeclaration" && init.kind !== "var")) return ast;
  let stmt = init.type === "VariableDeclaration" ? init : t.expressionStatement((init: any));
  let effects = evaluateSpeculatively(realm, () =>
    realm.evaluateForEffects(() => env.evaluate(stmt, strictCode), undefined, "residualLoop/init")
  );
  if (!(effects instanceof Effects) || !(effects.result instanceof SimpleNormalCompletion)) return ast;
  realm.applyEffects(effects, "residualLoop/init");
  return (({ ...ast, init: null }: any): BabelNodeStatement);
}

export function residualizeLoop(
  realm: Realm,
  ast: BabelNodeStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  labelSet: ?Array<string>,
  reason: string
): Value {
  invariant(realm.isInPureScope());
  ast = evaluateForInit(realm, ast, strictCode, env);
  let transformed = transformLoop(ast, labelSet);
  let state = transformed.state;
  if (state.unsupported !== undefined) fail(realm, `${state.unsupported} (${reason})`, ast.loc);

  let loopEnv = Environment.NewDeclarativeEnvironment(realm, env);
  try {
    return emitResidualLoop(realm, ast, transformed, strictCode, env, loopEnv, labelSet, reason);
  } finally {
    realm.onDestroyScope(loopEnv);
  }
}

function emitResidualLoop(
  realm: Realm,
  ast: BabelNodeStatement,
  transformed: TransformedLoop,
  strictCode: boolean,
  env: LexicalEnvironment,
  loopEnv: LexicalEnvironment,
  labelSet: ?Array<string>,
  reason: string
): Value {
  let state = transformed.state;
  let needsExitCode = state.usesReturn || state.exits.length > 0;
  let loopEnvRec = loopEnv.environmentRecord;

  let effectsOrFailure = evaluateSpeculatively(realm, () =>
    realm.evaluateForEffects(
      () => {
        if (state.usesReturn) {
          loopEnvRec.CreateMutableBinding(VALUE_NAME, false);
          loopEnvRec.InitializeBinding(VALUE_NAME, realm.intrinsics.undefined);
          (loopEnvRec: any).bindings[VALUE_NAME].mightHaveBeenCaptured = true;
        }
        if (state.usesArguments) {
          let argumentsValue = Environment.GetValue(realm, env.evaluate(t.identifier("arguments"), strictCode));
          loopEnvRec.CreateImmutableBinding(ARGUMENTS_NAME, true);
          loopEnvRec.InitializeBinding(ARGUMENTS_NAME, argumentsValue);
          (loopEnvRec: any).bindings[ARGUMENTS_NAME].mightHaveBeenCaptured = true;
        }
        let wrapperStatements = [transformed.labeled];
        if (needsExitCode) wrapperStatements.push(t.returnStatement(t.numericLiteral(0)));
        let wrapperBody = t.blockStatement(wrapperStatements);
        let wrapper = new ECMAScriptSourceFunctionValue(realm);
        wrapper.initialize([], wrapperBody);
        wrapper.$Environment = loopEnv;

        let thisVal;
        if (state.usesThis) thisVal = Environment.GetValue(realm, env.evaluate(t.thisExpression(), strictCode));

        // Havoc everything the loop can reach.
        Leak.value(realm, wrapper);
        if (thisVal !== undefined) Leak.value(realm, thisVal);

        // Evaluate one abstract iteration to find out what the loop might modify.
        let trialBody = makeTrialBody(transformed.loop, labelSet);
        let firstEnvId = EnvironmentRecord.nextId;
        let trialEffects = realm.evaluateForEffects(
          () => {
            let trialEnv = Environment.NewDeclarativeEnvironment(realm, loopEnv);
            try {
              if (t.isForInStatement(ast) || t.isForOfStatement(ast)) {
                // The key/value of an arbitrary iteration (this entry is discarded with the trial)
                let key = AbstractValue.createTemporalFromBuildFunction(
                  realm,
                  t.isForInStatement(ast) ? StringValue : Value,
                  [],
                  createOperationDescriptor("NOOP"),
                  { skipInvariant: true }
                );
                trialEnv.environmentRecord.CreateImmutableBinding(KEY_NAME, true);
                trialEnv.environmentRecord.InitializeBinding(KEY_NAME, key);
              }
              let trial = Functions.FunctionCreate(realm, "normal", [], trialBody, trialEnv, strictCode);
              return Call(realm, trial, thisVal || realm.intrinsics.undefined, []);
            } finally {
              realm.onDestroyScope(trialEnv);
            }
          },
          undefined,
          "residualLoop/trial"
        );
        let problem = checkTrialEffects(realm, trialEffects, firstEnvId);
        if (problem !== undefined) throw new FatalError(problem);

        let args = [wrapper];
        if (thisVal !== undefined) args.push(thisVal);
        return AbstractValue.createTemporalFromBuildFunction(
          realm,
          needsExitCode ? NumberValue : UndefinedValue,
          args,
          createOperationDescriptor("FOR_STATEMENT_FUNC", { usesThis: thisVal !== undefined })
        );
      },
      undefined,
      "residualLoop"
    )
  );
  if (!(effectsOrFailure instanceof Object) || effectsOrFailure.failure !== undefined) {
    fail(realm, `${(effectsOrFailure: any).failure} (${reason})`, ast.loc);
  }
  let effects: Effects = (effectsOrFailure: any);
  let result = effects.result;
  if (result instanceof AbruptCompletion) fail(realm, `unexpected abrupt completion (${reason})`, ast.loc);
  invariant(result instanceof Completion);
  let exitValue = result.value;
  realm.applyEffects(effects, "residualLoop");

  // The wrapper call can throw whatever the loop throws.
  realm.evaluateWithPossibleThrowCompletion(() => exitValue, TypesDomain.topVal, ValuesDomain.topVal);
  if (!needsExitCode) return realm.intrinsics.undefined;

  // Rebuild the completions that left the loop early.
  let exitEnv = Environment.NewDeclarativeEnvironment(realm, loopEnv);
  exitEnv.environmentRecord.CreateImmutableBinding(CODE_NAME, true);
  exitEnv.environmentRecord.InitializeBinding(CODE_NAME, exitValue);
  let checks = [];
  let isCode = n => t.binaryExpression("===", t.identifier(CODE_NAME), t.numericLiteral(n));
  if (state.usesReturn) checks.push(t.ifStatement(isCode(1), t.returnStatement(t.identifier(VALUE_NAME))));
  state.exits.forEach((exit, i) => {
    let jump =
      exit.kind === "break"
        ? t.breakStatement(t.identifier(exit.label))
        : t.continueStatement(t.identifier(exit.label));
    checks.push(t.ifStatement(isCode(i + 2), jump));
  });
  let block = t.blockStatement(checks);
  let savedEnv = realm.getRunningContext().lexicalEnvironment;
  realm.getRunningContext().lexicalEnvironment = exitEnv;
  try {
    exitEnv.evaluate(block, strictCode);
  } finally {
    realm.getRunningContext().lexicalEnvironment = savedEnv;
    realm.onDestroyScope(exitEnv);
  }
  return realm.intrinsics.undefined;
}
