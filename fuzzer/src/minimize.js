/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// AST-based test case reducer. Repeatedly applies one small edit (delete a
// statement, array element or switch case; replace a compound statement with
// one of its parts; replace an expression with a subexpression or a literal)
// and keeps it if the program still fails in the same way. Candidates are
// checked in parallel batches on the worker pool.
//
// CLI: node src/minimize.js <file.js> [--prepack <lib>] [--jobs N] [--time S] [--out <file>]

const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

function parse(code) {
  return parser.parse(code, { sourceType: "script" });
}

function print(ast) {
  return generate(ast, { comments: false, retainLines: false }).code + "\n";
}

const LITERALS = [
  () => t.numericLiteral(0),
  () => t.booleanLiteral(true),
  () => t.stringLiteral(""),
  () => t.identifier("undefined"),
];

// Collects edits in a deterministic order. Each edit is a function that mutates the AST in place.
function collectEdits(ast, coarse) {
  const edits = [];
  traverse(ast, {
    enter(path) {
      const node = path.node;
      const parent = path.parent;
      // Keep the inspect() harness (fmt, fns, try/catch) intact; only shrink the `args` tuples inside it.
      if (t.isAssignmentExpression(node) && t.isIdentifier(node.left, { name: "inspect" })) {
        path.traverse({
          VariableDeclarator(vp) {
            if (t.isIdentifier(vp.node.id, { name: "args" }) && t.isArrayExpression(vp.node.init)) {
              for (const elem of vp.get("init.elements")) {
                edits.push(() => elem.remove());
              }
            }
            vp.skip();
          },
        });
        path.skip();
        return;
      }
      // Removals of list elements.
      if (path.listKey && (path.listKey === "body" || path.listKey === "consequent" || path.listKey === "cases")) {
        if (t.isStatement(node) || t.isSwitchCase(node)) edits.push(() => path.remove());
      }
      if (path.listKey === "elements" && t.isArrayExpression(parent)) edits.push(() => path.remove());
      if (path.listKey === "properties" && t.isObjectExpression(parent)) edits.push(() => path.remove());
      if (path.listKey === "arguments" && t.isCallExpression(parent) && isGeneratedCallee(parent.callee)) {
        // Arguments of generated helpers can go when trailing; params then read undefined.
        if (path.key === parent.arguments.length - 1) edits.push(() => path.remove());
      }

      // Compound statements to a part.
      if (t.isIfStatement(node)) {
        edits.push(() => path.replaceWith(node.consequent));
        if (node.alternate) {
          edits.push(() => path.replaceWith(node.alternate));
          edits.push(() => {
            node.alternate = null;
          });
        }
      }
      if (t.isLoop(node)) edits.push(() => path.replaceWith(node.body));
      if (t.isTryStatement(node)) {
        edits.push(() => path.replaceWith(node.block));
        if (node.handler && node.finalizer) {
          edits.push(() => {
            node.handler = null;
          });
          edits.push(() => {
            node.finalizer = null;
          });
        }
        if (node.handler && !node.finalizer) edits.push(() => path.replaceWith(node.handler.body));
      }
      if (t.isLabeledStatement(node)) edits.push(() => path.replaceWith(node.body));
      if (t.isBlockStatement(node) && t.isBlockStatement(parent) && node.body.length) {
        edits.push(() => path.replaceWithMultiple(node.body));
      }
      if (
        t.isVariableDeclarator(node) &&
        node.init &&
        path.parentPath.parent &&
        !t.isForStatement(path.parentPath.parent)
      ) {
        edits.push(() => {
          node.init = null;
        });
      }

      // Expressions to a subexpression or a literal.
      if (!coarse && t.isExpression(node) && isValuePosition(path)) {
        for (const child of subExpressions(node)) edits.push(() => path.replaceWith(t.cloneNode(child)));
        if (!t.isLiteral(node) && !(t.isIdentifier(node) && node.name === "undefined")) {
          for (const lit of LITERALS) edits.push(() => path.replaceWith(lit()));
        } else if (t.isLiteral(node) && !(t.isNumericLiteral(node) && node.value === 0)) {
          edits.push(() => path.replaceWith(t.numericLiteral(0)));
        }
      }
    },
  });
  return edits;
}

function isGeneratedCallee(callee) {
  return t.isIdentifier(callee) && /^[hfg]\d+$/.test(callee.name);
}

function subExpressions(node) {
  if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) return [node.left, node.right];
  if (t.isConditionalExpression(node)) return [node.test, node.consequent, node.alternate];
  if (t.isUnaryExpression(node)) return node.operator === "delete" ? [] : [node.argument];
  if (t.isSequenceExpression(node)) return node.expressions;
  if (t.isCallExpression(node)) return node.arguments.filter(a => t.isExpression(a));
  if (t.isMemberExpression(node)) return [node.object];
  if (t.isAssignmentExpression(node)) return [node.right];
  return [];
}

function isValuePosition(path) {
  const parent = path.parent;
  const key = path.key;
  if (t.isLVal(path.node) && (t.isAssignmentExpression(parent) || t.isUpdateExpression(parent)) && key !== "right")
    return false;
  if (t.isUpdateExpression(parent)) return false;
  if (t.isUnaryExpression(parent) && parent.operator === "delete") return false;
  if (t.isMemberExpression(parent) && key === "property" && !parent.computed) return false;
  if (t.isObjectProperty(parent) && key === "key") return false;
  if (t.isCallExpression(parent) && key === "callee") return false;
  if (t.isFunction(parent) && key !== "body") return false;
  if (t.isVariableDeclarator(parent) && key === "id") return false;
  if (t.isCatchClause(parent)) return false;
  if (t.isForInStatement(parent) && key === "left") return false;
  if (t.isFunction(path.node)) return false;
  if (t.isLabeledStatement(parent) || t.isBreakStatement(parent) || t.isContinueStatement(parent)) return false;
  if (t.isExpressionStatement(parent) && t.isStringLiteral(path.node) && path.node.value === "use strict") return false;
  return true;
}

function applyEdit(code, index, coarse) {
  const ast = parse(code);
  const edits = collectEdits(ast, coarse);
  if (index >= edits.length) return undefined;
  try {
    edits[index]();
    return print(ast);
  } catch (e) {
    return null;
  }
}

function countEdits(code, coarse) {
  return collectEdits(parse(code), coarse).length;
}

// Signature a candidate must keep to count as "the same failure".
function failureKey(result) {
  if (result.status === "wrong" || result.status === "wrong-recovered") {
    return result.status + (result.detail && result.detail.startsWith("residual throws") ? ":throws" : "");
  }
  return result.status + ":" + normalizeDetail(result.detail);
}

function normalizeDetail(detail) {
  return String(detail || "")
    .replace(/\d+/g, "N")
    .replace(/"[^"]*"/g, '"S"')
    .slice(0, 200);
}

async function minimize(pool, code, target, opts = {}) {
  const key = failureKey(target);
  const deadline = Date.now() + (opts.time || 300) * 1000;
  const batch = opts.batch || 4;
  let current = print(parse(code));
  let tests = 0;
  let progress = true;
  // First only statement-level edits (cheap, large steps), then everything.
  let coarse = true;
  while ((progress || coarse) && Date.now() < deadline) {
    if (!progress) coarse = false;
    progress = false;
    let index = 0;
    while (Date.now() < deadline) {
      const total = countEdits(current, coarse);
      if (index >= total) break;
      const candidates = [];
      for (let i = index; i < Math.min(total, index + batch); i++) {
        const c = applyEdit(current, i, coarse);
        if (c && c !== current && c.length <= current.length + 20) candidates.push({ i, code: c });
      }
      const results = await Promise.all(candidates.map(c => pool.run({ code: c.code })));
      tests += candidates.length;
      const hit = candidates.findIndex((c, j) => failureKey(results[j]) === key);
      if (hit >= 0) {
        current = candidates[hit].code;
        index = candidates[hit].i;
        progress = true;
        if (opts.onProgress) opts.onProgress(current, tests);
      } else {
        index += batch;
      }
    }
  }
  const final = await pool.run({ code: current, full: true });
  return { code: current, tests, result: final, key, complete: !progress };
}

module.exports = { minimize, failureKey, normalizeDetail };

if (require.main === module) {
  const fs = require("fs");
  const { Pool } = require("./pool");
  const args = require("./args").parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) {
    console.error("usage: node src/minimize.js <file.js> [--prepack <lib>] [--jobs N] [--time S] [--out file]");
    process.exit(2);
  }
  const code = fs.readFileSync(file, "utf8");
  const pool = new Pool(args.jobs, args.runOptions, args.timeout);
  (async () => {
    const first = await pool.run({ code, full: true });
    console.error(`initial: ${first.status} ${first.detail || ""}`);
    if (!["wrong", "wrong-recovered", "invariant", "crash", "fatal"].includes(first.status)) {
      console.error("program does not fail; nothing to minimize");
      pool.close();
      process.exit(1);
    }
    const r = await minimize(pool, code, first, { time: args.time || 300, batch: args.jobs });
    console.error(`minimized in ${r.tests} tests: ${r.result.status} ${r.result.detail || ""}`);
    if (args.out) fs.writeFileSync(args.out, r.code);
    else process.stdout.write(r.code);
    if (r.result.expected !== undefined) console.error(`expected: ${r.result.expected}\nactual:   ${r.result.actual}`);
    pool.close();
  })();
}
