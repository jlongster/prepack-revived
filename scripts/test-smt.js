/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @noflow (plain Node script; not @flow-typed) */

/*
 * Differential test of the SMT translation (src/utils/smt/translate.js) against real JS semantics.
 *
 *   node scripts/test-smt.js [--count N] [--seed S] [--depth D] [--verbose]
 *
 * Builds random small expressions over typed abstract leaves and constants, evaluates them concretely in Node,
 * and asks z3 about the translated term with the leaves fixed to the same concrete values:
 *   - soundness: "translated expression = actual JS result" must be satisfiable (otherwise the model is wrong and
 *     z3 could prove false facts). Any failure here is a bug.
 *   - precision: "translated expression != actual JS result" should be unsatisfiable (the model determines the
 *     value). Opaque parts (ToString of a computed number, %, bitwise ops, objects) legitimately fail this; we
 *     report the rate and fail only for expressions that use no opaque operation.
 * Needs `yarn build-prepack` first, and z3 on the PATH.
 */

const path = require("path");
const lib = path.join(__dirname, "..", "lib");
require(path.join(lib, "initialize-singletons.js")).default();
const construct_realm = require(path.join(lib, "construct_realm.js")).default;
const initializeGlobals = require(path.join(lib, "globals.js")).default;
const V = require(path.join(lib, "values", "index.js"));
const T = require(path.join(lib, "utils", "smt", "translate.js"));
const { Z3Process, findZ3 } = require(path.join(lib, "utils", "smt", "z3.js"));

let args = { count: 3000, seed: 1, depth: 3, verbose: false };
for (let i = 2; i < process.argv.length; i++) {
  let a = process.argv[i];
  if (a === "--count") args.count = +process.argv[++i];
  else if (a === "--seed") args.seed = +process.argv[++i];
  else if (a === "--depth") args.depth = +process.argv[++i];
  else if (a === "--verbose") args.verbose = true;
}

let seed = args.seed;
function rnd(n) {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) % n;
}
function pick(a) {
  return a[rnd(a.length)];
}

const binary = findZ3();
if (binary === undefined) {
  console.log("z3 not found; skipping SMT translation tests");
  process.exit(0);
}

// Bridge lifecycle checks: missing binary, child crash recovery, and hard timeout recovery.
{
  let assert = (cond, msg) => {
    if (!cond) throw new Error("bridge check failed: " + msg);
  };
  let missing = new Z3Process("/nonexistent/z3-binary", 500, "(set-option :print-success false)");
  assert(missing.run("(check-sat)") === undefined, "missing binary returns undefined");
  assert(missing.disabled === true, "missing binary disables bridge");

  let crashy = new Z3Process(binary, 2000, "(set-option :print-success false)\n(declare-const g Int)");
  assert(crashy.run("(push)(assert (> g 0))(check-sat)(pop)").trim() === "sat", "initial query works");
  crashy.child.kill("SIGKILL");
  // Either this call or the next notices the dead pipe; the subsequent call must restart cleanly with prelude intact.
  let afterKill = crashy.run("(push)(assert (> g 0))(check-sat)(pop)");
  if (afterKill === undefined) afterKill = crashy.run("(push)(assert (> g 0))(check-sat)(pop)");
  assert(afterKill !== undefined && afterKill.trim() === "sat", "recovers from SIGKILL with prelude replayed");
  crashy.close();
}

const z3 = new Z3Process(binary, 20000, "(set-option :rlimit 10000000)\n" + T.SMT_PRELUDE);

let realm = construct_realm({ serialize: true });
initializeGlobals(realm);

// Exact small dyadic floats + special values so exact Real arithmetic (+, -, * by constant) matches IEEE-754.
// (IEEE-754 rounding/overflow on values like 1 - 1e21 or 0.5 - 0.1 is intentionally approximated by the Real model.)
const NUMBERS = [0, -0, 1, -1, 2, -2, 0.5, -0.25, 3, 10, 100, NaN, Infinity, -Infinity];
const STRINGS = ["", "0", "1", "a", "abc", " 1 ", "b", "10", "-0", "true", "Infinity", "\u00e9", "\ud83d\ude00"];
const OTHERS = [true, false, undefined, null];
const ALL = [...NUMBERS, ...STRINGS, ...OTHERS];

const LEAF_TYPES = [
  ["number", V.NumberValue, NUMBERS],
  ["string", V.StringValue, STRINGS],
  ["boolean", V.BooleanValue, [true, false]],
  ["primitive", V.PrimitiveValue, ALL],
  ["any", V.Value, [...ALL, "<object>", "<function>"]],
  ["object", V.ObjectValue, ["<object>", "<function>"]],
];

const BIN_OPS = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "===",
  "!==",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
];
const IMPRECISE_BIN = new Set(["*", "/", "%", "&", "|", "^", "<<", ">>", ">>>"]);
const UN_OPS = ["!", "-", "+", "typeof", "void", "~"];

function concreteValue(x) {
  if (typeof x === "number") return new V.NumberValue(realm, x);
  if (typeof x === "string") return new V.StringValue(realm, x);
  if (typeof x === "boolean") return new V.BooleanValue(realm, x);
  if (x === undefined) return realm.intrinsics.undefined;
  if (x === null) return realm.intrinsics.null;
  throw new Error("unexpected");
}

function jsLiteral(x) {
  if (typeof x === "number") return Object.is(x, -0) ? "(-0)" : `(${String(x)})`;
  if (typeof x === "string") return JSON.stringify(x);
  if (x !== null && (typeof x === "object" || typeof x === "function")) return "<object>";
  return String(x);
}

// Returns { value: Prepack Value, js: source, imprecise: boolean }
function gen(depth, leaves) {
  let r = rnd(10);
  if (depth === 0 || r < 2) {
    if (rnd(3) === 0) {
      let x = pick(ALL);
      return { value: concreteValue(x), js: jsLiteral(x), imprecise: false };
    }
    let leaf = pick(leaves);
    return { value: leaf.value, js: leaf.name, imprecise: false };
  }
  if (r < 4) {
    let op = pick(UN_OPS);
    let a = genAbstract(depth - 1, leaves);
    let v = V.AbstractValue.createFromUnaryOp(realm, op, a.value, true, undefined, false, true);
    return { value: v, js: `(${op} ${a.js})`, imprecise: a.imprecise || op === "~" };
  }
  if (r < 6) {
    let op = pick(["&&", "||"]);
    let a = genAbstract(depth - 1, leaves);
    let b = gen(depth - 1, leaves);
    let v = V.AbstractValue.createFromLogicalOp(realm, op, a.value, b.value, undefined, false, true);
    return { value: v, js: `(${a.js} ${op} ${b.js})`, imprecise: a.imprecise || b.imprecise };
  }
  if (r < 7) {
    let c = genAbstract(depth - 1, leaves);
    let a = gen(depth - 1, leaves);
    let b = gen(depth - 1, leaves);
    let v = V.AbstractValue.createFromConditionalOp(realm, c.value, a.value, b.value, undefined, false, true);
    return { value: v, js: `(${c.js} ? ${a.js} : ${b.js})`, imprecise: c.imprecise || a.imprecise || b.imprecise };
  }
  let op = pick(BIN_OPS);
  let a = genAbstract(depth - 1, leaves);
  let b = gen(depth - 1, leaves);
  let [x, y] = rnd(2) === 0 ? [a, b] : [b, a];
  let v = V.AbstractValue.createFromBinaryOp(realm, op, x.value, y.value, undefined, undefined, false, true);
  return {
    value: v,
    js: `(${x.js} ${op} ${y.js})`,
    // ToString of a computed number goes through the uninterpreted numstr
    imprecise: x.imprecise || y.imprecise || IMPRECISE_BIN.has(op) || op === "+",
  };
}

function genAbstract(depth, leaves) {
  for (let i = 0; i < 10; i++) {
    let e = gen(depth, leaves);
    if (e.value instanceof V.AbstractValue) return e;
  }
  let leaf = pick(leaves);
  return { value: leaf.value, js: leaf.name, imprecise: false };
}

let counter = 0;
let failures = 0;
let objectCases = 0;
let precise = 0;
let preciseTotal = 0;
let impreciseExact = 0;
let impreciseTotal = 0;
let start = Date.now();

for (let i = 0; i < args.count; i++) {
  let leaves = [];
  let nLeaves = 1 + rnd(3);
  for (let j = 0; j < nLeaves; j++) {
    let [tname, type, pool] = pick(LEAF_TYPES);
    let name = `x${j}`;
    let value = V.AbstractValue.createAbstractArgument(realm, `${name}_${counter++}`, undefined, type);
    let actual = pick(pool);
    let kind = actual === "<object>" || actual === "<function>" ? actual : undefined;
    if (actual === "<object>") actual = {};
    else if (actual === "<function>") actual = function() {};
    leaves.push({ name, tname, value, actual, kind });
  }
  let e;
  try {
    e = genAbstract(args.depth, leaves);
  } catch (err) {
    if (args.verbose)
      console.log(
        "skip: " +
          err.stack
            .split("\n")
            .slice(0, 4)
            .join(" / ")
      );
    continue; // Prepack refused to build the value (e.g. an invariant on types)
  }
  let fn = require("vm").runInNewContext(`(${leaves.map(l => l.name).join(", ")}) => (${e.js})`);
  let actual;
  try {
    actual = fn(...leaves.map(l => l.actual));
  } catch (err) {
    continue; // throws in JS: no value to compare with
  }
  let t = new T.SmtTranslator();
  let term = t.term(e.value);
  let objectLeaf = leaves.find(l => l.kind !== undefined && l.actual === actual);
  let actualTerm = objectLeaf !== undefined ? t.term(objectLeaf.value) : t.term(concreteValue(actual));
  let fix = leaves.map((l, j) =>
    l.kind !== undefined
      ? `(assert (= ${t.term(l.value)} (Obj ${1000 + j})))\n(assert ${
          l.kind === "<function>" ? "" : "(not "
        }(callable ${1000 + j})${l.kind === "<function>" ? "" : ")"})`
      : `(assert (= ${t.term(l.value)} ${t.term(concreteValue(l.actual))}))`
  );
  // ground ToNumber for the strings in the pool
  let strnum = STRINGS.map(s => `(assert (= (strnum ${T.stringLiteral(s)}) ${T.numberLiteral(Number(s))}))`);
  let base = `${t.script()}\n${fix.join("\n")}\n${strnum.join("\n")}`;
  let checkCmd = "(check-sat-using (then simplify solve-eqs smt))";
  let sound = z3.run(`(push)\n${base}\n(assert (= ${term} ${actualTerm}))\n${checkCmd}\n(pop)`);
  let exact = z3.run(`(push)\n${base}\n(assert (not (= ${term} ${actualTerm})))\n${checkCmd}\n(pop)`);
  let usesObjects = leaves.some(l => l.kind !== undefined);
  if (usesObjects) objectCases++;
  let report = what => {
    failures++;
    console.log(`${what}: ${e.js}`);
    console.log(`  leaves: ${leaves.map(l => `${l.name}:${l.tname}=${l.kind || jsLiteral(l.actual)}`).join(", ")}`);
    console.log(`  JS result: ${jsLiteral(actual)}; z3: sound=${String(sound).trim()} exact=${String(exact).trim()}`);
    if (args.verbose) console.log(base + `\n(assert (= ${term} ${actualTerm}))`);
  };
  if (sound === undefined || exact === undefined || sound.includes("error") || exact.includes("error")) {
    report("Z3 ERROR");
    continue;
  }
  if (sound.trim() !== "sat") report("UNSOUND");
  if (e.imprecise || usesObjects) {
    impreciseTotal++;
    if (exact.trim() === "unsat") impreciseExact++;
  } else {
    preciseTotal++;
    if (exact.trim() === "unsat") precise++;
    else report("IMPRECISE");
  }
}
z3.close();
console.log(
  `${args.count} expressions, ${failures} failures; precise ops determined: ${precise}/${preciseTotal}; ` +
    `with opaque ops or objects determined: ${impreciseExact}/${impreciseTotal} (${objectCases} with objects); ${Date.now() -
      start} ms`
);
process.exit(failures > 0 ? 1 : 0);
