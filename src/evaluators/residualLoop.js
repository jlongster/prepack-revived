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
 * Residual loops for loops whose trip count is unknown at build time.
 *
 * The loop statement is emitted verbatim inside a residual closure that is called once, at the point in time where
 * the loop runs. Every mutable binding the closure writes to and every object reachable from the loop that was
 * created in the current scope is leaked (materialized) first, so the loop runs against the real runtime state and
 * everything after the loop reads that state back residually. Read-only local bindings of an optimized function are
 * passed to the closure as parameters instead of being leaked as mutable storage.
 *
 * To make sure the loop cannot touch anything untracked (such as outer/global state in an optimized function, or
 * unknown functions / non-syntactic global mutations in global code), one abstract iteration of the loop is evaluated
 * against the leaked state. If that trial modifies any binding or property that is neither leaked nor created by the
 * trial itself, the loop is rejected with a diagnostic.
 *
 * Exits out of the loop that the closure cannot express directly (return, and break/continue to labels outside the
 * loop) are encoded as a numeric result of the closure; the completion is then rebuilt after the call.
 */

import {
  DeclarativeEnvironmentRecord,
  EnvironmentRecord,
  FunctionEnvironmentRecord,
  GlobalEnvironmentRecord,
  ObjectEnvironmentRecord,
  leakBinding,
  type LexicalEnvironment,
} from "../environment.js";
import { cloneDescriptor, PropertyDescriptor } from "../descriptors.js";
import { Effects, type Realm } from "../realm.js";
import {
  AbstractValue,
  ArrayValue,
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
  ThrowCompletion,
} from "../completions.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { Call } from "../methods/call.js";
import { Environment, Functions, Leak } from "../singletons.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { createOperationDescriptor, Generator, TemporalOperationEntry } from "../utils/generator.js";
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
const ARGUMENTS_NAME = "__prepack_args";
const CODE_NAME = "__prepack_loop_exit";
const KEY_NAME = "__prepack_loop_key";
const ONCE_NAME = "__prepack_loop_once";
const SWITCH_PREFIX = "__prepack_switch_";

const SAFE_LEAKED_ARRAY_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "reverse",
  "join",
  "slice",
  "indexOf",
  "lastIndexOf",
  "includes",
  "concat",
]);

type LoopExit = { kind: "break" | "continue", label: string };

type TransformState = {
  root: BabelNode,
  usesThis: boolean,
  usesArguments: boolean,
  usesReturn: boolean,
  exits: Array<LoopExit>,
  unsupported: void | string,
  freeNames: Array<string>,
  assignedNames: Set<string>,
  capturedByInnerFunction: Set<string>,
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

let trialDepth = 0;

function markExit(node: any) {
  node.prepackLoopExit = true;
  return node;
}

function isReservedName(name: string): boolean {
  return (
    name === VALUE_NAME ||
    name === ARGUMENTS_NAME ||
    name === CODE_NAME ||
    name === KEY_NAME ||
    name === ONCE_NAME ||
    name.startsWith(SWITCH_PREFIX)
  );
}

function convertDeclarators(declarators: Array<any>): Array<BabelNodeExpression> {
  // `var x;` does not reset x on each iteration, so declarators without initializer are dropped.
  return declarators
    .filter(d => d.init != null)
    .map(d => ((t.assignmentExpression("=", d.id, d.init): any): BabelNodeExpression));
}

let LoopTransformVisitor = {
  WithStatement(_path: BabelTraversePath, state: TransformState) {
    state.unsupported = "the loop contains a with statement";
  },
  Super(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, false) === state.root) state.unsupported = "the loop uses super";
  },
  "YieldExpression|AwaitExpression"(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, true) === state.root) state.unsupported = "the loop contains yield or await";
  },
  CallExpression(path: BabelTraversePath, state: TransformState) {
    if (t.isIdentifier(path.node.callee, { name: "eval" })) state.unsupported = "the loop calls eval";
  },
  UnaryExpression(path: BabelTraversePath, state: TransformState) {
    if (path.node.operator === "delete" && t.isIdentifier(path.node.argument)) {
      state.unsupported = "the loop deletes an identifier";
    }
  },
  "AssignmentExpression|UpdateExpression"(path: BabelTraversePath, state: TransformState) {
    let target = path.isUpdateExpression() ? path.node.argument : path.node.left;
    if (
      t.isMemberExpression(target) &&
      t.isIdentifier(target.object, { name: "arguments" }) &&
      nearestFunction(path, false) === state.root
    ) {
      state.unsupported = "the loop mutates arguments elements";
    }
  },
  ThisExpression(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, false) === state.root) state.usesThis = true;
  },
  ReferencedIdentifier(path: BabelTraversePath, state: TransformState) {
    let name = path.node.name;
    if (!path.node.prepackGenerated && trialDepth === 0 && isReservedName(name)) {
      state.unsupported = `the loop uses the reserved name ${name}`;
    } else if (name === "arguments" && nearestFunction(path, false) === state.root) {
      state.usesArguments = true;
      let id: any = t.identifier(ARGUMENTS_NAME);
      id.prepackGenerated = true;
      path.replaceWith(id);
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

let FreeNamesVisitor = {
  Program(path: BabelTraversePath, state: TransformState) {
    state.freeNames = Object.keys(path.scope.globals);
  },
  ReferencedIdentifier(path: BabelTraversePath, state: TransformState) {
    if (nearestFunction(path, true) !== state.root && !path.scope.hasBinding(path.node.name)) {
      state.capturedByInnerFunction.add(path.node.name);
    }
  },
  "AssignmentExpression|UpdateExpression|ForInStatement|ForOfStatement"(
    path: BabelTraversePath,
    state: TransformState
  ) {
    let node = path.node;
    let target = path.isUpdateExpression() ? node.argument : path.isAssignmentExpression() ? node.left : node.left;
    if (t.isVariableDeclaration(target)) return;
    for (let name of Object.keys(t.getBindingIdentifiers(target))) {
      if (!path.scope.hasBinding(name)) state.assignedNames.add(name);
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
    freeNames: [],
    assignedNames: new Set(),
    capturedByInnerFunction: new Set(),
  };
  traverse(t.file(t.program([t.expressionStatement(root)])), LoopTransformVisitor, null, state);
  traverse.cache.clear();
  // Compute the identifiers that the transformed loop does not declare itself.
  traverse(t.file(t.program([t.expressionStatement(root)])), FreeNamesVisitor, null, state);
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

// SwitchStatement.js only handles abstract discriminants when cases.length < 6. For the discarded trial AST only,
// lower larger switch statements to a labeled block with an index variable that preserves ECMA-262 selector order
// (including `default` in the middle) and fallthrough.
function lowerTrialSwitches(block: BabelNodeBlockStatement): void {
  let counter = 0;
  let root = t.functionExpression(null, [], block);
  traverse(t.file(t.program([t.expressionStatement(root)])), {
    SwitchStatement: {
      exit(path: BabelTraversePath) {
        if (nearestFunction(path, true) !== root) return;
        let cases = path.node.cases;
        if (cases.length < 6) return;
        for (let c of cases) {
          for (let s of c.consequent) {
            if (
              (t.isVariableDeclaration(s) && s.kind !== "var") ||
              t.isFunctionDeclaration(s) ||
              t.isClassDeclaration(s)
            ) {
              return;
            }
          }
        }
        let id = counter++;
        let labelId = t.identifier(`${SWITCH_PREFIX}${id}`);
        let discId = t.identifier(`${SWITCH_PREFIX}disc_${id}`);
        let idxId = t.identifier(`${SWITCH_PREFIX}idx_${id}`);
        path.traverse({
          BreakStatement(breakPath: BabelTraversePath) {
            if (breakPath.node.label != null) return;
            let target = breakPath.findParent(p => p.isLoop() || p.isSwitchStatement());
            if (target === path) breakPath.replaceWith(t.breakStatement(t.identifier(labelId.name)));
          },
        });
        let defaultIdx = cases.findIndex(c => c.test == null);
        let selectChain: ?BabelNodeStatement =
          defaultIdx >= 0
            ? t.expressionStatement(t.assignmentExpression("=", t.identifier(idxId.name), t.numericLiteral(defaultIdx)))
            : null;
        for (let i = cases.length - 1; i >= 0; i--) {
          let test = cases[i].test;
          if (test == null) continue;
          selectChain = t.ifStatement(
            t.binaryExpression("===", t.identifier(discId.name), test),
            t.expressionStatement(t.assignmentExpression("=", t.identifier(idxId.name), t.numericLiteral(i))),
            selectChain
          );
        }
        let bodyStmts: Array<BabelNodeStatement> = [
          t.variableDeclaration("let", [
            t.variableDeclarator(discId, path.node.discriminant),
            t.variableDeclarator(idxId, t.numericLiteral(-1)),
          ]),
        ];
        if (selectChain != null) bodyStmts.push(selectChain);
        let runCases: Array<BabelNodeStatement> = [];
        for (let i = 0; i < cases.length; i++) {
          if (cases[i].consequent.length === 0) continue;
          runCases.push(
            t.ifStatement(
              t.binaryExpression("<=", t.identifier(idxId.name), t.numericLiteral(i)),
              t.blockStatement(cases[i].consequent)
            )
          );
        }
        if (runCases.length > 0) {
          bodyStmts.push(
            t.ifStatement(
              t.binaryExpression(">=", t.identifier(idxId.name), t.numericLiteral(0)),
              t.blockStatement(runCases)
            )
          );
        }
        path.replaceWith(t.labeledStatement(labelId, t.blockStatement(bodyStmts)));
      },
    },
  });
  traverse.cache.clear();
}

// One iteration of the loop. `break` and `continue` that target the loop end the iteration. The iteration is
// expressed as a for statement that runs once and that is never residualized itself (see ForStatement.js).
function makeTrialBody(loop: BabelNodeStatement, labelSet: ?Array<string>): BabelNodeBlockStatement {
  let n: any = t.cloneDeep(loop);
  let once = body => {
    let flag = t.identifier(ONCE_NAME);
    let node: any = t.forStatement(
      t.variableDeclaration("let", [t.variableDeclarator(flag, t.booleanLiteral(true))]),
      t.identifier(ONCE_NAME),
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
  let trialBlock = t.blockStatement(stmts);
  lowerTrialSwitches(trialBlock);
  return trialBlock;
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

function hasUnsafeGlobalCallBailout(generators: Array<Generator>): boolean {
  let seen = new Set();
  let stack = generators.slice();
  while (stack.length > 0) {
    let gen = stack.pop();
    if (seen.has(gen)) continue;
    seen.add(gen);
    for (let entry of gen._entries) {
      let deps = entry.getDependencies();
      if (deps !== undefined) {
        for (let dep of deps) stack.push(dep);
      }
      if (entry instanceof TemporalOperationEntry && entry.operationDescriptor.type === "CALL_BAILOUT") {
        let { thisArg, propRef } = entry.operationDescriptor.data;
        if (
          thisArg instanceof ArrayValue &&
          !thisArg.mightNotBeLeakedObject() &&
          typeof propRef === "string" &&
          SAFE_LEAKED_ARRAY_METHODS.has(propRef)
        ) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
}

// Checks that the trial iteration only modified leaked state or state it created itself.
function checkTrialEffects(
  realm: Realm,
  effects: Effects,
  firstEnvId: number,
  globalProperties: Set<string>,
  inGlobalCode: boolean
): void | string {
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
      if (!pb.object.mightNotBeLeakedObject() && !pb.internalSlot) continue;
      if (pb.object === realm.$GlobalObject && typeof pb.key === "string" && globalProperties.has(pb.key)) continue;
      return `the loop may modify ${describeProperty(
        pb
      )}, which was not created by the optimized function or is not tracked`;
    }
  }
  if (inGlobalCode) {
    if (mightThrow(effects.result)) return "the loop might throw an exception";
    if (hasUnsafeGlobalCallBailout(all.map(e => e.generator))) {
      return "the loop calls an unknown or unsupported function in global code";
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
    realm.evaluateForEffects(() => env.evaluateCompletionDeref(stmt, strictCode), undefined, "residualLoop/init")
  );
  if (!(effects instanceof Effects) || !(effects.result instanceof SimpleNormalCompletion)) return ast;
  realm.applyEffects(effects, "residualLoop/init");
  return (({ ...ast, init: null }: any): BabelNodeStatement);
}

function resolveName(env: LexicalEnvironment, name: string): void | EnvironmentRecord {
  for (let e = env; e; e = e.parent) {
    if (e.environmentRecord.HasBinding(name)) return e.environmentRecord;
  }
  return undefined;
}

function leakEnclosingFunctionBindings(realm: Realm, env: LexicalEnvironment): void {
  for (let e = env; e; e = e.parent) {
    let record = e.environmentRecord;
    if (record instanceof FunctionEnvironmentRecord) {
      for (let name of Object.keys(record.bindings)) {
        if (name === "arguments") continue;
        let b = record.bindings[name];
        if (b !== undefined && b.initialized && b.value !== undefined && !b.hasLeaked) {
          Leak.value(realm, b.value);
        }
      }
      return;
    }
  }
}

function collectReadOnlyParams(
  realm: Realm,
  env: LexicalEnvironment,
  state: TransformState
): Array<{ name: string, value: Value, binding: Binding }> {
  let params = [];
  for (let name of state.freeNames) {
    if (state.assignedNames.has(name) || state.capturedByInnerFunction.has(name) || isReservedName(name)) continue;
    let record = resolveName(env, name);
    if (!(record instanceof DeclarativeEnvironmentRecord)) continue;
    if (record.creatingOptimizedFunction !== realm.currentOptimizedFunction) continue;
    let binding = record.bindings[name];
    if (binding === undefined || !binding.initialized || binding.hasLeaked) continue;
    let val = binding.value;
    if (val === undefined) continue;
    params.push({ name, value: val, binding });
  }
  return params;
}

// In global code Prepack does not know which objects were created by the program (everything was), so all objects
// the loop can reach are leaked, including the ones held by global variables. Returns the global variables (properties
// of the global object) that the loop assigns to.
function leakForGlobalCode(
  realm: Realm,
  wrapper: ECMAScriptSourceFunctionValue,
  state: TransformState,
  loopEnv: LexicalEnvironment
): Array<string> {
  let saved = realm.createdObjectsTrackedForLeaks;
  realm.createdObjectsTrackedForLeaks = (({ has: () => true }: any): Set<ObjectValue>);
  let globalProperties = [];
  try {
    Leak.value(realm, wrapper);
    for (let name of state.freeNames) {
      let record = resolveName(loopEnv, name);
      if (record instanceof ObjectEnvironmentRecord) throw new FatalError("the loop is inside a with statement");
      if (!(record instanceof GlobalEnvironmentRecord)) continue;
      let declarativeRecord = record.$DeclarativeRecord;
      invariant(declarativeRecord instanceof DeclarativeEnvironmentRecord);
      let binding = declarativeRecord.bindings[name];
      if (binding !== undefined) {
        if (binding.value !== undefined && !binding.hasLeaked) Leak.value(realm, binding.value);
        leakBinding(binding);
        continue;
      }
      let globalObject = realm.$GlobalObject;
      invariant(globalObject instanceof ObjectValue);
      let pb = globalObject.properties.get(name);
      let desc = pb && pb.descriptor;
      let isDataProperty = desc instanceof PropertyDescriptor && desc.value instanceof Value;
      if (isDataProperty) Leak.value(realm, (desc: any).value);
      if (state.assignedNames.has(name)) {
        if (!isDataProperty || !(desc: any).writable) {
          throw new FatalError(`the loop assigns ${name}, which is not a known global variable`);
        }
        globalProperties.push(name);
      }
    }
  } finally {
    realm.createdObjectsTrackedForLeaks = saved;
  }
  return globalProperties;
}

// Forget the values of the given global variables: from now on they are read from the global object.
function havocGlobalProperties(realm: Realm, names: Array<string>): void {
  let globalObject = realm.$GlobalObject;
  invariant(globalObject instanceof ObjectValue);
  for (let name of names) {
    let pb = globalObject.properties.get(name);
    invariant(pb !== undefined);
    let pbDesc = pb.descriptor;
    invariant(pbDesc instanceof PropertyDescriptor);
    let value = AbstractValue.createTemporalFromBuildFunction(
      realm,
      Value,
      [globalObject, new StringValue(realm, name)],
      createOperationDescriptor("OBJECT_GET_PARTIAL"),
      { skipInvariant: true, isPure: true }
    );
    let desc = cloneDescriptor(pbDesc);
    invariant(desc !== undefined);
    desc.value = value;
    realm.recordModifiedProperty(pb);
    pb.descriptor = desc;
  }
}

function mightThrow(c: any): boolean {
  if (c instanceof ThrowCompletion) return true;
  if (c instanceof JoinedNormalAndAbruptCompletions || c instanceof JoinedAbruptCompletions) {
    return mightThrow(c.consequent) || mightThrow(c.alternate) || mightThrow(c.composedWith);
  }
  return false;
}

export function residualizeLoop(
  realm: Realm,
  ast: BabelNodeStatement,
  strictCode: boolean,
  env: LexicalEnvironment,
  labelSet: ?Array<string>,
  reason: string
): Value {
  ast = evaluateForInit(realm, ast, strictCode, env);
  let transformed = transformLoop(ast, labelSet);
  let state = transformed.state;
  if (state.unsupported !== undefined) fail(realm, `${state.unsupported} (${reason})`, ast.loc);

  let inGlobalCode = !realm.isInPureScope();
  let readOnlyCandidates = inGlobalCode ? [] : collectReadOnlyParams(realm, env, state);
  let leakedCandidates: Set<string> = new Set();
  let attempt = (params: Array<{ name: string, value: Value, binding: Binding }>) => {
    let loopEnv = Environment.NewDeclarativeEnvironment(realm, env);
    try {
      let out = tryResidualLoop(
        realm,
        ast,
        transformed,
        strictCode,
        env,
        loopEnv,
        labelSet,
        reason,
        params,
        leakedCandidates
      );
      if (out.effects === undefined) realm.onDestroyScope(loopEnv);
      return out;
    } catch (e) {
      realm.onDestroyScope(loopEnv);
      throw e;
    }
  };

  let res = attempt(readOnlyCandidates);
  if (res.effects === undefined && leakedCandidates.size > 0) {
    let remaining = readOnlyCandidates.filter(p => !leakedCandidates.has(p.name));
    res = attempt(remaining);
  }
  if (res.effects === undefined && readOnlyCandidates.length > 0 && leakedCandidates.size === 0) {
    // A helper called inside the loop may have mutated an outer local binding that was not syntactically assigned.
    res = attempt([]);
  }
  let effects = res.effects;
  if (effects === undefined) {
    fail(realm, `${res.failure || "unknown reason"} (${reason})`, ast.loc);
  }
  let loopEnv = res.loopEnv;
  try {
    invariant(effects !== undefined);
    let result = effects.result;
    if (result instanceof AbruptCompletion) fail(realm, `unexpected abrupt completion (${reason})`, ast.loc);
    invariant(result instanceof Completion);
    let exitValue = result.value;
    realm.applyEffects(effects, "residualLoop");

    // The wrapper call can throw whatever the loop throws.
    if (!inGlobalCode) {
      realm.evaluateWithPossibleThrowCompletion(() => exitValue, TypesDomain.topVal, ValuesDomain.topVal);
    }
    let needsExitCode = state.usesReturn || state.exits.length > 0;
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
  } finally {
    realm.onDestroyScope(loopEnv);
  }
}

function tryResidualLoop(
  realm: Realm,
  ast: BabelNodeStatement,
  transformed: TransformedLoop,
  strictCode: boolean,
  env: LexicalEnvironment,
  loopEnv: LexicalEnvironment,
  labelSet: ?Array<string>,
  reason: string,
  params: Array<{ name: string, value: Value, binding: Binding }>,
  leakedCandidates: Set<string>
): { effects?: Effects, loopEnv: LexicalEnvironment, failure?: string } {
  let state = transformed.state;
  let needsExitCode = state.usesReturn || state.exits.length > 0;
  let loopEnvRec = loopEnv.environmentRecord;
  let inGlobalCode = !realm.isInPureScope();
  if (inGlobalCode && (needsExitCode || state.usesArguments)) {
    return { loopEnv, failure: "unsupported exit from a loop in global code" };
  }

  let effectsOrFailure = evaluateSpeculatively(realm, () =>
    realm.evaluateForEffects(
      () => {
        if (state.usesReturn) {
          loopEnvRec.CreateMutableBinding(VALUE_NAME, false);
          loopEnvRec.InitializeBinding(VALUE_NAME, realm.intrinsics.undefined);
          (loopEnvRec: any).bindings[VALUE_NAME].mightHaveBeenCaptured = true;
        }
        let paramIds = params.map(p => t.identifier(p.name));
        let paramValues = params.map(p => p.value);
        let wrapperParamIds = state.usesArguments ? [t.identifier(ARGUMENTS_NAME), ...paramIds] : paramIds;
        let wrapperStatements = [transformed.labeled];
        if (needsExitCode) wrapperStatements.push(t.returnStatement(t.numericLiteral(0)));
        let wrapperBody = t.blockStatement(wrapperStatements);
        let wrapper = new ECMAScriptSourceFunctionValue(realm);
        wrapper.initialize(wrapperParamIds, wrapperBody);
        wrapper.$Environment = loopEnv;

        let thisVal;
        if (state.usesThis) thisVal = Environment.GetValue(realm, env.evaluate(t.thisExpression(), strictCode));

        // Havoc everything the loop can reach.
        let globalProperties = [];
        if (inGlobalCode) {
          globalProperties = leakForGlobalCode(realm, wrapper, state, loopEnv);
        } else {
          for (let v of paramValues) Leak.value(realm, v);
          if (state.usesArguments) leakEnclosingFunctionBindings(realm, env);
          Leak.value(realm, wrapper);
          if (thisVal !== undefined) Leak.value(realm, thisVal);
          for (let p of params) {
            if (p.binding.hasLeaked) leakedCandidates.add(p.name);
          }
          if (leakedCandidates.size > 0) {
            throw new FatalError("read-only loop parameter binding was leaked");
          }
        }

        // Evaluate one abstract iteration to find out what the loop might modify.
        let trialBody = makeTrialBody(transformed.loop, labelSet);
        let firstEnvId = EnvironmentRecord.nextId;
        let savedTracked = realm.createdObjectsTrackedForLeaks;
        if (inGlobalCode) realm.createdObjectsTrackedForLeaks = new Set();
        let trialEffects;
        try {
          trialEffects = realm.evaluateForEffects(
            () => {
              let trialEnv = Environment.NewDeclarativeEnvironment(realm, loopEnv);
              try {
                havocGlobalProperties(realm, globalProperties);
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
                let trialArgs = paramValues;
                if (state.usesArguments) {
                  let absArgs = AbstractValue.createTemporalFromBuildFunction(
                    realm,
                    ObjectValue,
                    [],
                    createOperationDescriptor("NOOP"),
                    { skipInvariant: true }
                  );
                  trialArgs = [absArgs, ...paramValues];
                }
                let trial = Functions.FunctionCreate(realm, "normal", wrapperParamIds, trialBody, trialEnv, strictCode);
                trialDepth++;
                try {
                  return Call(realm, trial, thisVal || realm.intrinsics.undefined, trialArgs);
                } finally {
                  trialDepth--;
                }
              } finally {
                realm.onDestroyScope(trialEnv);
              }
            },
            undefined,
            "residualLoop/trial"
          );
        } finally {
          realm.createdObjectsTrackedForLeaks = savedTracked;
        }
        let problem = checkTrialEffects(realm, trialEffects, firstEnvId, new Set(globalProperties), inGlobalCode);
        if (problem !== undefined) throw new FatalError(problem);

        let args = [wrapper];
        if (thisVal !== undefined) args.push(thisVal);
        for (let v of paramValues) args.push(v);
        let exitValue = AbstractValue.createTemporalFromBuildFunction(
          realm,
          needsExitCode ? NumberValue : UndefinedValue,
          args,
          createOperationDescriptor("FOR_STATEMENT_FUNC", {
            usesThis: thisVal !== undefined,
            usesArguments: state.usesArguments,
          })
        );
        // Global variables assigned by the loop are read back after it.
        havocGlobalProperties(realm, globalProperties);
        return exitValue;
      },
      undefined,
      "residualLoop"
    )
  );
  if (!(effectsOrFailure instanceof Effects)) {
    return { loopEnv, failure: (effectsOrFailure: any).failure };
  }
  return { effects: effectsOrFailure, loopEnv };
}
