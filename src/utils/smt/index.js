/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

// Z3-backed answers to the yes/no questions Prepack asks about path conditions, plus an audit of simplifier rewrites.
//
// Modes (PrepackOptions.smt, or the PREPACK_SMT environment variable):
//   off      - never call the solver (also automatic when z3 is not installed).
//   fallback - default when z3 is installed: when the hand-written rules cannot decide an implication, ask z3; detect
//              infeasible branches.
//   audit    - fallback, plus check every simplifier rewrite and every positive answer of the hand-written rules.
//              Unsound steps are reported with a counterexample (PREPACK_SMT_AUDIT_LOG=<file> appends JSON lines,
//              PREPACK_SMT_AUDIT_THROW=1 throws instead).
// Any solver failure (not installed, timeout, crash, untranslatable value) is "don't know", which is always safe.

import type { Realm } from "../../realm.js";
import { AbstractValue, EmptyValue, Value } from "../../values/index.js";
import { SmtTranslator, SMT_PRELUDE, TranslationError, describe } from "./translate.js";
import { Z3Process, findZ3, type Z3Answer } from "./z3.js";

export type SmtMode = "off" | "fallback" | "audit";
export const SmtModeValues = ["off", "fallback", "audit"];

// z3's resource limit per check-sat. Normal Prepack queries take <10k units (<1ms); capping at 200k prevents blowups on
// huge unrolled expressions.
const DEFAULT_RLIMIT = 200000;
// Hard limit for one round trip; beyond it the z3 process is killed and the answer is "unknown".
const HARD_TIMEOUT_MS = 5000;
const CACHE_LIMIT = 100000;

export type SmtStats = {
  queries: number,
  cacheHits: number,
  sat: number,
  unsat: number,
  unknown: number,
  untranslatable: number,
  solverMs: number,
  auditChecks: number,
  auditFailures: number,
};

let stats: SmtStats = {
  queries: 0,
  cacheHits: 0,
  sat: 0,
  unsat: 0,
  unknown: 0,
  untranslatable: 0,
  solverMs: 0,
  auditChecks: 0,
  auditFailures: 0,
};

export function getSmtStats(): SmtStats {
  return Object.assign({}, stats);
}

let z3: void | null | Z3Process; // null: looked for z3 and did not find it
let cache: Map<string, Z3Answer> = new Map();

const CHECK_SAT = "(check-sat-using (then simplify solve-eqs smt))";

function solver(): void | Z3Process {
  if (z3 === undefined) {
    let binary = findZ3();
    if (binary === undefined) {
      z3 = null;
    } else {
      let timeout = Number(process.env.PREPACK_SMT_TIMEOUT) || 0;
      let rlimit = Number(process.env.PREPACK_SMT_RLIMIT) || DEFAULT_RLIMIT;
      let limitOpt = timeout > 0 ? `(set-option :timeout ${timeout})` : `(set-option :rlimit ${rlimit})`;
      let hardTimeout = timeout > 0 ? Math.max(HARD_TIMEOUT_MS, timeout * 4) : HARD_TIMEOUT_MS;
      z3 = new Z3Process(binary, hardTimeout, `${limitOpt}\n` + SMT_PRELUDE);
    }
  }
  if (z3 === null || z3.disabled) return undefined;
  return z3;
}

export function isSmtAvailable(): boolean {
  return solver() !== undefined;
}

export function resolveSmtMode(option: void | SmtMode): SmtMode {
  let mode = option;
  if (mode === undefined && typeof process !== "undefined") {
    let env = process.env.PREPACK_SMT;
    if (env === "off" || env === "fallback" || env === "audit") mode = env;
  }
  return mode || "fallback";
}

export function smtEnabled(realm: Realm): boolean {
  return realm.smtMode !== "off" && solver() !== undefined;
}

export function smtAuditing(realm: Realm): boolean {
  return realm.smtMode === "audit" && solver() !== undefined;
}

// Runs `(push) script check (pop)`; returns the answer and, for "sat" with `model`, the raw get-value output.
function check(script: string, modelTerms?: Array<string>): [Z3Answer, string] {
  let z = solver();
  if (z === undefined) return ["unknown", ""];
  let cacheable = modelTerms === undefined;
  if (cacheable) {
    let cached = cache.get(script);
    if (cached !== undefined) {
      stats.cacheHits++;
      return [cached, ""];
    }
  }
  stats.queries++;
  let start = Date.now();
  let wantModel = modelTerms !== undefined && modelTerms.length > 0;
  let out = z.run(`(push)\n${script}\n${CHECK_SAT}${wantModel ? "" : "\n(pop)"}`);
  let answer = "unknown";
  let rest = "";
  if (out !== undefined) {
    let trimmed = out.trim();
    if (trimmed.includes("(error")) {
      if (process.env.PREPACK_SMT_DEBUG) {
        console.error("z3 error: " + trimmed + "\nscript:\n" + script);
      }
    } else if (trimmed === "unsat") answer = "unsat";
    else if (trimmed === "sat") answer = "sat";
  }
  if (wantModel && out !== undefined) {
    let model = answer === "sat" && modelTerms !== undefined ? z.run(`(get-value (${modelTerms.join(" ")}))`) : "";
    z.run("(pop)");
    rest = model === undefined ? "" : model.trim();
  }
  stats.solverMs += Date.now() - start;
  stats[answer]++;
  if (cacheable) {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(script, answer);
  }
  return [answer, rest];
}

// Builds a query: background facts, assumptions (each must be truthy), and a final goal formula.
function build(
  assumptions: $ReadOnlyArray<Value>,
  goal: SmtTranslator => string
): void | { script: string, translator: SmtTranslator } {
  let t = new SmtTranslator();
  try {
    let asserts = assumptions.map(c => `(assert ${t.truthy(c)})`);
    let g = goal(t);
    return { script: `${t.script()}\n${asserts.join("\n")}\n(assert ${g})`, translator: t };
  } catch (e) {
    if (e instanceof TranslationError || e instanceof RangeError) {
      stats.untranslatable++;
      return undefined;
    }
    throw e;
  }
}

// Is the conjunction of assumptions plus `goal` unsatisfiable? (true only when proven)
function provenUnsat(assumptions: $ReadOnlyArray<Value>, goal: SmtTranslator => string): boolean {
  let q = build(assumptions, goal);
  if (q === undefined) return false;
  return check(q.script)[0] === "unsat";
}

// Collects the hashValues of opaque leaves reachable inside `v` so unrelated path conditions can be sliced away.
function collectLeafHashes(v: Value, out: Set<number>, seen: Set<AbstractValue>): void {
  if (!(v instanceof AbstractValue) || seen.has(v)) return;
  seen.add(v);
  let entry = v.$Realm.getTemporalOperationEntryFromDerivedValue(v);
  if (entry !== undefined && entry.isPure === true) {
    if (entry.args.length === 0) out.add(v.hashValue);
    else for (let a of entry.args) collectLeafHashes(a, out, seen);
    return;
  }
  if (v.intrinsicName !== undefined || v.args.length === 0) {
    out.add(v.hashValue);
  }
  for (let a of v.args) collectLeafHashes(a, out, seen);
}

// Keeps only assumptions transitively sharing at least one leaf hash with `target` (sound by monotonicity: dropping
// assumptions can never fabricate an `unsat` proof).
function sliceRelevantAssumptions(assumptions: $ReadOnlyArray<Value>, target: Value): Array<Value> {
  if (assumptions.length === 0) return [];
  let relevant = new Set();
  collectLeafHashes(target, relevant, new Set());
  if (relevant.size === 0) return [];
  let perAssumption = assumptions.map(a => {
    let s = new Set();
    collectLeafHashes(a, s, new Set());
    return s;
  });
  let kept = new Array(assumptions.length).fill(false);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < assumptions.length; i++) {
      if (kept[i]) continue;
      let s = perAssumption[i];
      let hits = false;
      for (let h of s) {
        if (relevant.has(h)) {
          hits = true;
          break;
        }
      }
      if (hits) {
        kept[i] = true;
        for (let h of s) relevant.add(h);
        changed = true;
      }
    }
  }
  let result = [];
  for (let i = 0; i < assumptions.length && result.length < 32; i++) {
    if (kept[i]) result.push(assumptions[i]);
  }
  return result;
}

// conditions => condition (truthy)
export function smtImplies(conditions: $ReadOnlyArray<Value>, condition: Value): boolean {
  return provenUnsat(sliceRelevantAssumptions(conditions, condition), t => `(not ${t.truthy(condition)})`);
}

// conditions => !condition
export function smtImpliesNot(conditions: $ReadOnlyArray<Value>, condition: Value): boolean {
  return provenUnsat(sliceRelevantAssumptions(conditions, condition), t => t.truthy(condition));
}

// The path conditions themselves are contradictory.
export function smtInfeasible(conditions: $ReadOnlyArray<Value>): boolean {
  return provenUnsat(conditions, () => "true");
}

// conditions => value is a JS object (typeof === "object" && !== null, or typeof === "function")
export function smtIsObject(conditions: $ReadOnlyArray<Value>, value: Value): boolean {
  let relevant = sliceRelevantAssumptions(conditions, value);
  if (relevant.length === 0) return false;
  return provenUnsat(relevant, t => `(not ((_ is Obj) ${t.term(value)}))`);
}

export type Counterexample = { [string]: string };

// Returns a counterexample if `goal` can hold together with the assumptions, undefined if it cannot (or unknown).
function findCounterexample(assumptions: $ReadOnlyArray<Value>, goal: SmtTranslator => string): void | Counterexample {
  let q = build(assumptions, goal);
  if (q === undefined) return undefined;
  let leaves = q.translator.leaves;
  let [answer, model] = check(q.script, leaves.map(l => l.name));
  if (answer !== "sat") return undefined;
  let values = parseModel(model);
  let result = {};
  for (let leaf of leaves) result[leaf.label] = values.get(leaf.name) || "?";
  return result;
}

// Audit: is `from` -> `to` a sound rewrite under the current path conditions?
export function auditRewrite(
  realm: Realm,
  conditions: $ReadOnlyArray<Value>,
  from: AbstractValue,
  to: Value,
  isCondition: boolean
): void {
  // Prepack's internal EmptyValue sentinel promotes to `undefined` on value reads while comparing !== undefined on
  // raw descriptors; skip JS-value equivalence checks on trees containing it.
  if (containsEmptySentinel(from) || containsEmptySentinel(to)) return;
  stats.auditChecks++;
  let cex = findCounterexample(conditions, t =>
    isCondition ? `(not (= ${t.truthy(from)} ${t.truthy(to)}))` : `(not (same ${t.term(from)} ${t.term(to)}))`
  );
  if (cex === undefined) return;
  report(realm, {
    kind: isCondition ? "rewrite (as condition)" : "rewrite",
    from: describe(from),
    to: describe(to),
    pathConditions: conditions.map(c => describe(c)),
    counterexample: cex,
  });
}

function containsEmptySentinel(v: Value, depth: number = 0): boolean {
  if (v instanceof EmptyValue) return true;
  if (!(v instanceof AbstractValue) || depth > 6) return false;
  if (v.mightBeEmpty) return true;
  for (let a of v.args) if (containsEmptySentinel(a, depth + 1)) return true;
  return false;
}

// Audit: the hand-written rules claimed conditions => (negated ? !condition : condition).
export function auditImplication(
  realm: Realm,
  conditions: $ReadOnlyArray<Value>,
  condition: Value,
  negated: boolean
): void {
  stats.auditChecks++;
  let cex = findCounterexample(conditions, t => (negated ? t.truthy(condition) : `(not ${t.truthy(condition)})`));
  if (cex === undefined) return;
  report(realm, {
    kind: negated ? "impliesNot" : "implies",
    from: describe(condition),
    to: negated ? "false" : "true",
    pathConditions: conditions.map(c => describe(c)),
    counterexample: cex,
  });
}

// Audit: a path condition derived by pushPathCondition / refinement must follow from the path plus the pushed condition.
export function auditDerivedCondition(
  realm: Realm,
  conditions: $ReadOnlyArray<Value>,
  pushed: Value,
  pushedInverse: boolean,
  derived: Value
): void {
  stats.auditChecks++;
  let cex = findCounterexample(conditions, t =>
    pushedInverse
      ? `(and (not ${t.truthy(pushed)}) (not ${t.truthy(derived)}))`
      : `(and ${t.truthy(pushed)} (not ${t.truthy(derived)}))`
  );
  let origin = (pushedInverse ? "push !" : "push ") + describe(pushed);
  if (cex === undefined) return;
  report(realm, {
    kind: "derived path condition",
    from: origin,
    to: describe(derived),
    pathConditions: conditions.map(c => describe(c)),
    counterexample: cex,
  });
}

let reported: Set<string> = new Set();

function report(
  realm: Realm,
  r: { kind: string, from: string, to: string, pathConditions: Array<string>, counterexample: Counterexample }
): void {
  stats.auditFailures++;
  let message =
    `Prepack SMT audit: unsound ${r.kind}: ${r.from} ~> ${r.to}` +
    (r.pathConditions.length > 0 ? ` under [${r.pathConditions.join(", ")}]` : "") +
    `; counterexample: ${JSON.stringify(r.counterexample)}`;
  if (process.env.PREPACK_SMT_AUDIT_THROW) {
    let error = new Error(message);
    error.name = "SmtAuditError";
    throw error;
  }
  if (reported.has(message)) return;
  reported.add(message);
  let log = process.env.PREPACK_SMT_AUDIT_LOG;
  if (log) {
    let stack = (new Error().stack || "")
      .split("\n")
      .slice(2, 12)
      .map(s => s.trim());
    let entry = Object.assign({}, r, { file: realm.smtAuditContext, stack });
    require("fs").appendFileSync(log, JSON.stringify(entry) + "\n");
  } else {
    console.error(message);
  }
}

// ---- reading z3 models back into JS-ish strings ----

type SExpr = string | Array<SExpr>;

function parseSExprs(text: string): Array<SExpr> {
  let i = 0;
  function skip() {
    while (i < text.length && /\s/.test(text[i])) i++;
  }
  function parse(): SExpr {
    skip();
    if (text[i] === "(") {
      i++;
      let list = [];
      for (;;) {
        skip();
        if (i >= text.length) return list;
        if (text[i] === ")") {
          i++;
          return list;
        }
        list.push(parse());
      }
    }
    if (text[i] === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= text.length) break;
        if (text[j] === '"') {
          if (text[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      let s = text.slice(i, j + 1);
      i = j + 1;
      return s;
    }
    let j = i;
    while (j < text.length && !/[\s()]/.test(text[j])) j++;
    let atom = text.slice(i, j);
    i = j === i ? j + 1 : j;
    return atom;
  }
  let result = [];
  for (;;) {
    skip();
    if (i >= text.length) break;
    result.push(parse());
  }
  return result;
}

function parseModel(text: string): Map<string, string> {
  let result = new Map();
  let exprs = parseSExprs(text);
  let list = exprs[0];
  if (!Array.isArray(list)) return result;
  for (let pair of list) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    let key = pair[0];
    if (typeof key !== "string") continue;
    result.set(key, renderJS(pair[1]));
  }
  return result;
}

function renderJS(e: SExpr): string {
  if (typeof e === "string") {
    if (e === "Undef") return "undefined";
    if (e === "Null") return "null";
    if (e === "Empty") return "<empty>";
    return e;
  }
  let head = e[0];
  if (head === "Num") return renderNumber(e[1]);
  if (head === "Bool") return String(e[1]);
  if (head === "Str" && typeof e[1] === "string") return JSON.stringify(decodeString(e[1]));
  if (head === "Obj") return `<object ${flat(e[1])}>`;
  if (head === "Sym") return `<symbol ${flat(e[1])}>`;
  return flat(e);
}

function flat(e: SExpr): string {
  return typeof e === "string" ? e : `(${e.map(flat).join(" ")})`;
}

export function renderNumber(e: SExpr): string {
  if (e === "NaN") return "NaN";
  if (e === "PInf") return "Infinity";
  if (e === "NInf") return "-Infinity";
  if (Array.isArray(e) && e[0] === "Fin" && e.length === 2) {
    let v = evalReal(e[1]);
    if (v !== undefined) return Object.is(v, -0) ? "0" : String(v);
  }
  return flat(e);
}

function evalReal(e: SExpr): void | number {
  if (typeof e === "string") {
    let n = Number(e);
    return Number.isNaN(n) ? undefined : n;
  }
  if (e[0] === "-" && e.length === 2) {
    let a = evalReal(e[1]);
    return a === undefined ? undefined : -a;
  }
  if (e[0] === "/" && e.length === 3) {
    let a = evalReal(e[1]);
    let b = evalReal(e[2]);
    return a === undefined || b === undefined || b === 0 ? undefined : a / b;
  }
  return undefined;
}

function decodeString(lit: string): string {
  let body = lit.slice(1, -1).replace(/""/g, '"');
  return body.replace(/\\u\{([0-9a-fA-F]+)\}/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
