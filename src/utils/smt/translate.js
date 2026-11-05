/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

// Translation of Prepack values into SMT-LIB terms over a tagged JS value datatype.
//
// Every JS value is a `JS`: (Num N) | (Bool Bool) | (Str String) | Undef | Null | (Obj Int) | (Sym Int) | Empty.
// Numbers are `N`: (Fin Real) | NaN | PInf | NInf.
//   - Comparisons, ===, ==, ToBoolean, NaN, and +/-Infinity are exact.
//   - Finite numbers are modelled as exact Reals: -0 is identified with +0 (indistinguishable by ===, ==, <, and
//     truthiness; Object.is and 1/x are not modelled), and + / - / multiplication by a constant do not model IEEE-754
//     rounding or overflow to Infinity. Non-linear *, /, %, ** and bitwise ops use an uninterpreted function `numop`
//     so queries stay in fast linear arithmetic while preserving congruence.
// Strings are Z3 strings with one character per UTF-16 code unit, so length and ordering match JS.
//
// Soundness rule: anything this module does not model precisely becomes an *opaque* term: a fresh constant
// (or an uninterpreted function where Prepack has already proven the operation pure/deterministic). An opaque term is
// only constrained by facts Prepack itself establishes (its TypesDomain / ValuesDomain / union structure), never by
// guesses. Opaque terms are keyed by Prepack's structural equality (AbstractValue.equals), plus pure temporal entries.

import type { OperationDescriptor } from "../generator.js";
import {
  AbstractValue,
  BooleanValue,
  ConcreteValue,
  EmptyValue,
  FunctionValue,
  NullValue,
  NumberValue,
  ObjectValue,
  PrimitiveValue,
  StringValue,
  SymbolValue,
  UndefinedValue,
  Value,
} from "../../values/index.js";

export const SMT_PRELUDE = `(set-option :print-success false)
(set-option :produce-models true)
(declare-datatypes () ((N (Fin (fv Real)) (NaN) (PInf) (NInf))))
(declare-datatypes () ((JS (Num (jn N)) (Bool (jb Bool)) (Str (js String)) (Undef) (Null) (Obj (jo Int)) (Sym (jy Int)) (Empty))))
(declare-fun callable (Int) Bool)
(declare-fun strnum (String) N)
(declare-fun numstr (N) String)
(declare-fun numop (Int N N) N)
(declare-fun objnum (JS) N)
(declare-fun objstr (JS) String)
(declare-fun objprim (JS) JS)
(declare-fun objprim_num (JS) JS)
(define-fun pz () N (Fin 0.0))
(define-fun one () N (Fin 1.0))
(define-fun nzero ((n N)) Bool (and ((_ is Fin) n) (= (fv n) 0.0)))
(define-fun nneg ((n N)) N (ite ((_ is Fin) n) (Fin (- (fv n))) (ite ((_ is PInf) n) NInf (ite ((_ is NInf) n) PInf NaN))))
(define-fun nadd ((a N) (b N)) N
  (ite (or ((_ is NaN) a) ((_ is NaN) b)) NaN
  (ite ((_ is PInf) a) (ite ((_ is NInf) b) NaN PInf)
  (ite ((_ is NInf) a) (ite ((_ is PInf) b) NaN NInf)
  (ite ((_ is PInf) b) PInf
  (ite ((_ is NInf) b) NInf
  (Fin (+ (fv a) (fv b)))))))))
(define-fun nsub ((a N) (b N)) N (nadd a (nneg b)))
(define-fun neq ((a N) (b N)) Bool (and (not ((_ is NaN) a)) (= a b)))
(define-fun nlt ((a N) (b N)) Bool
  (ite (or ((_ is NaN) a) ((_ is NaN) b)) false
  (ite ((_ is NInf) a) (not ((_ is NInf) b))
  (ite ((_ is PInf) a) false
  (ite ((_ is PInf) b) true
  (ite ((_ is NInf) b) false
  (< (fv a) (fv b))))))))
(define-fun nle ((a N) (b N)) Bool (or (nlt a b) (neq a b)))
(define-fun truthy ((v JS)) Bool
  (ite ((_ is Num) v) (not (or ((_ is NaN) (jn v)) (nzero (jn v))))
  (ite ((_ is Bool) v) (jb v)
  (ite ((_ is Str) v) (not (= (js v) ""))
  (or ((_ is Obj) v) ((_ is Sym) v))))))
(define-fun nullish ((v JS)) Bool (or ((_ is Undef) v) ((_ is Null) v)))
(define-fun tonum ((v JS)) N
  (ite ((_ is Num) v) (jn v)
  (ite ((_ is Bool) v) (ite (jb v) one pz)
  (ite ((_ is Str) v) (strnum (js v))
  (ite ((_ is Null) v) pz
  (ite (or ((_ is Obj) v) ((_ is Sym) v)) (objnum v) NaN))))))
(define-fun tostr ((v JS)) String
  (ite ((_ is Str) v) (js v)
  (ite ((_ is Num) v) (numstr (jn v))
  (ite ((_ is Bool) v) (ite (jb v) "true" "false")
  (ite ((_ is Undef) v) "undefined"
  (ite ((_ is Null) v) "null" (objstr v)))))))
(define-fun seq ((a JS) (b JS)) Bool
  (ite (and ((_ is Num) a) ((_ is Num) b)) (neq (jn a) (jn b)) (= a b)))
(define-fun same ((a JS) (b JS)) Bool (= a b))
(define-fun numlike ((v JS)) Bool (or ((_ is Num) v) ((_ is Str) v) ((_ is Bool) v)))
(define-fun peq ((pa JS) (pb JS)) Bool
  (ite (and ((_ is Str) pa) ((_ is Str) pb)) (= pa pb)
  (ite (and (numlike pa) (numlike pb)) (neq (tonum pa) (tonum pb))
  (ite (and ((_ is Sym) pa) ((_ is Sym) pb)) (= pa pb)
  false))))
(define-fun leq ((a JS) (b JS) (pa JS) (pb JS)) Bool
  (ite (or ((_ is Empty) a) ((_ is Empty) b)) (= a b)
  (ite (and (nullish a) (nullish b)) true
  (ite (or (nullish a) (nullish b)) false
  (ite (and ((_ is Obj) a) ((_ is Obj) b)) (= a b)
  (peq pa pb))))))
(define-fun jlt ((pa JS) (pb JS)) Bool
  (ite (and ((_ is Str) pa) ((_ is Str) pb)) (str.< (js pa) (js pb))
  (nlt (tonum pa) (tonum pb))))
(define-fun jle ((pa JS) (pb JS)) Bool
  (ite (and ((_ is Str) pa) ((_ is Str) pb)) (str.<= (js pa) (js pb))
  (nle (tonum pa) (tonum pb))))
(define-fun jadd ((a JS) (b JS)) JS
  (ite (or ((_ is Str) a) ((_ is Str) b))
    (Str (str.++ (tostr a) (tostr b)))
    (Num (nadd (tonum a) (tonum b)))))
(define-fun jtypeof ((v JS)) String
  (ite ((_ is Num) v) "number"
  (ite ((_ is Bool) v) "boolean"
  (ite ((_ is Str) v) "string"
  (ite ((_ is Null) v) "object"
  (ite ((_ is Sym) v) "symbol"
  (ite ((_ is Obj) v) (ite (callable (jo v)) "function" "object")
  "undefined")))))))
`;

// Opcodes for the deterministic numeric operations modelled as an uninterpreted function `numop`.
const NUMOP_CODES = {
  "*": 11,
  "/": 12,
  "%": 1,
  "**": 2,
  "&": 3,
  "|": 4,
  "^": 5,
  "<<": 6,
  ">>": 7,
  ">>>": 8,
  "~": 9,
};

export class TranslationError extends Error {}

export type Leaf = { name: string, label: string };

export class SmtTranslator {
  constructor(maxNodes: number = 250) {
    this.decls = [];
    this.buckets = new Map();
    this.pureLeaves = [];
    this.objIds = new Map();
    this.counter = 0;
    this.nodes = 0;
    this.maxNodes = maxNodes;
    this.leaves = [];
    this.numConsts = new Map();
    this.strConsts = new Set();
    this.primAsserted = new Set();
  }

  decls: Array<string>;
  buckets: Map<number, Array<[AbstractValue, string]>>;
  pureLeaves: Array<[OperationDescriptor, Array<Value>, string]>;
  objIds: Map<ConcreteValue, number>;
  counter: number;
  nodes: number;
  maxNodes: number;
  leaves: Array<Leaf>;
  numConsts: Map<string, string>;
  strConsts: Set<string>;
  primAsserted: Set<string>;

  truthy(v: Value, depth: number = 0): string {
    if (v instanceof ConcreteValue) return v.mightNotBeTrue() ? "false" : "true";
    return `(truthy ${this.term(v, depth)})`;
  }

  // The script (declarations, definitions and background facts) needed by the terms produced so far.
  script(): string {
    return this.decls.join("\n");
  }

  term(v: Value, depth: number = 0): string {
    if (v instanceof ConcreteValue) return this.concrete(v);
    if (!(v instanceof AbstractValue)) throw new TranslationError("unexpected value");
    let bucket = this.buckets.get(v.hashValue);
    if (bucket === undefined) this.buckets.set(v.hashValue, (bucket = []));
    for (let [w, name] of bucket) if (w === v || w.equals(v)) return name;
    if (depth > 60) throw new TranslationError("expression too deep");
    let pureSpec = pureOperationSpec(v);
    if (pureSpec !== undefined) {
      let [od, args] = pureSpec;
      for (let [od2, args2, name] of this.pureLeaves) {
        if (samePureDescriptor(od, od2) && this.sameArgs(args, args2, depth + 1)) {
          bucket.push([v, name]);
          return name;
        }
      }
    }
    if (++this.nodes > this.maxNodes) throw new TranslationError("expression too large");
    let compound = this.compound(v, pureSpec, depth + 1);
    let name = `v${this.counter++}`;
    bucket.push([v, name]);
    if (pureSpec !== undefined) this.pureLeaves.push([pureSpec[0], pureSpec[1], name]);
    if (compound !== undefined) {
      this.decls.push(`(define-fun ${name} () JS ${compound})`);
    } else {
      this.decls.push(`(declare-const ${name} JS)`);
      let facts = this.leafFacts(v, name, depth + 1);
      if (facts.length > 0) this.decls.push(`(assert (and ${facts.join(" ")}))`);
      this.leaves.push({ name, label: describe(v) });
    }
    return name;
  }

  concrete(v: ConcreteValue): string {
    if (v instanceof EmptyValue) return "Empty";
    if (v instanceof UndefinedValue) return "Undef";
    if (v instanceof NullValue) return "Null";
    if (v instanceof BooleanValue) return `(Bool ${v.value ? "true" : "false"})`;
    if (v instanceof NumberValue) return `(Num ${this.number(v.value)})`;
    if (v instanceof StringValue) return `(Str ${this.string(v.value)})`;
    if (v instanceof SymbolValue) return `(Sym ${this.identity(v)})`;
    if (v instanceof ObjectValue) {
      let known = this.objIds.has(v);
      let id = this.identity(v);
      if (!known) {
        let callable = `(callable ${id})`;
        this.decls.push(`(assert ${v instanceof FunctionValue ? callable : `(not ${callable})`})`);
      }
      return `(Obj ${id})`;
    }
    throw new TranslationError("unexpected concrete value");
  }

  identity(v: ConcreteValue): number {
    let id = this.objIds.get(v);
    if (id === undefined) this.objIds.set(v, (id = -1 - this.objIds.size));
    return id;
  }

  number(x: number): string {
    let fp = numberLiteral(x);
    // Ground ToString facts for numbers that occur in the query (ToString of a number is otherwise opaque).
    let key = Object.is(x, -0) ? "-0" : String(x);
    if (!this.numConsts.has(key)) {
      this.numConsts.set(key, fp);
      this.decls.push(`(assert (= (numstr ${fp}) ${stringLiteral(String(x))}))`);
    }
    return fp;
  }

  string(s: string): string {
    let lit = stringLiteral(s);
    // Ground ToNumber facts for strings that occur in the query.
    if (!this.strConsts.has(s)) {
      this.strConsts.add(s);
      this.decls.push(`(assert (= (strnum ${lit}) ${numberLiteral(Number(s))}))`);
    }
    return lit;
  }

  // Returns an SMT term for an operator node, or undefined if the node must be treated as an opaque leaf.
  compound(v: AbstractValue, pureSpec: void | [OperationDescriptor, Array<Value>], depth: number): void | string {
    let kind = v.kind;
    let od = v.operationDescriptor;
    let args = v.args;
    if (v.intrinsicName !== undefined) {
      if (pureSpec === undefined) return undefined;
      [od, args] = pureSpec;
      kind = operatorKindOf(od);
    }
    if (kind === undefined || od === undefined) return undefined;
    switch (od.type) {
      case "CANNOT_BECOME_OBJECT": {
        if (args.length !== 1) return undefined;
        return `(Bool (nullish ${this.term(args[0], depth)}))`;
      }
      case "CONDITIONAL_EXPRESSION": {
        if (kind !== "conditional" || args.length !== 3) return undefined;
        return `(ite ${this.truthy(args[0], depth)} ${this.term(args[1], depth)} ${this.term(args[2], depth)})`;
      }
      case "LOGICAL_EXPRESSION": {
        if (args.length !== 2 || od.data.logicalOperator !== kind) return undefined;
        let a = this.term(args[0], depth);
        let b = this.term(args[1], depth);
        if (kind === "&&") return `(ite (truthy ${a}) ${b} ${a})`;
        if (kind === "||") return `(ite (truthy ${a}) ${a} ${b})`;
        return undefined;
      }
      case "UNARY_EXPRESSION": {
        if (args.length !== 1 || od.data.unaryOperator !== kind) return undefined;
        let a = this.term(args[0], depth);
        switch (kind) {
          case "!":
            return `(Bool (not (truthy ${a})))`;
          case "void":
            return "Undef";
          case "typeof":
            for (let name of ["number", "boolean", "string", "object", "function", "symbol", "undefined"]) {
              this.string(name);
            }
            return `(Str (jtypeof ${a}))`;
          case "-":
            return `(Num (nneg (tonum ${a})))`;
          case "+":
            return `(Num (tonum ${a}))`;
          case "~":
            return `(Num (numop ${NUMOP_CODES["~"]} (tonum ${a}) pz))`;
          default:
            return undefined;
        }
      }
      case "BINARY_EXPRESSION": {
        if (args.length !== 2 || od.data.binaryOperator !== kind) return undefined;
        let op = kind;
        let a = this.term(args[0], depth);
        let b = this.term(args[1], depth);
        switch (op) {
          case "===":
            return `(Bool (seq ${a} ${b}))`;
          case "!==":
            return `(Bool (not (seq ${a} ${b})))`;
          case "==": {
            let pa = this.toPrimitive(args[0], a, "objprim");
            let pb = this.toPrimitive(args[1], b, "objprim");
            return `(Bool (leq ${a} ${b} ${pa} ${pb}))`;
          }
          case "!=": {
            let pa = this.toPrimitive(args[0], a, "objprim");
            let pb = this.toPrimitive(args[1], b, "objprim");
            return `(Bool (not (leq ${a} ${b} ${pa} ${pb})))`;
          }
          case "<": {
            let pa = this.toPrimitive(args[0], a, "objprim_num");
            let pb = this.toPrimitive(args[1], b, "objprim_num");
            return `(Bool (jlt ${pa} ${pb}))`;
          }
          case "<=": {
            let pa = this.toPrimitive(args[0], a, "objprim_num");
            let pb = this.toPrimitive(args[1], b, "objprim_num");
            return `(Bool (jle ${pa} ${pb}))`;
          }
          case ">": {
            let pa = this.toPrimitive(args[0], a, "objprim_num");
            let pb = this.toPrimitive(args[1], b, "objprim_num");
            return `(Bool (jlt ${pb} ${pa}))`;
          }
          case ">=": {
            let pa = this.toPrimitive(args[0], a, "objprim_num");
            let pb = this.toPrimitive(args[1], b, "objprim_num");
            return `(Bool (jle ${pb} ${pa}))`;
          }
          case "+": {
            let pa = this.toPrimitive(args[0], a, "objprim");
            let pb = this.toPrimitive(args[1], b, "objprim");
            return `(jadd ${pa} ${pb})`;
          }
          case "-":
            return `(Num (nsub (tonum ${a}) (tonum ${b})))`;
          case "*": {
            if (args[0] instanceof NumberValue) return `(Num ${constMul(args[0].value, `(tonum ${b})`)})`;
            if (args[1] instanceof NumberValue) return `(Num ${constMul(args[1].value, `(tonum ${a})`)})`;
            return `(Num (numop ${NUMOP_CODES["*"]} (tonum ${a}) (tonum ${b})))`;
          }
          case "/":
          case "%":
          case "**":
          case "&":
          case "|":
          case "^":
          case "<<":
          case ">>":
          case ">>>":
            return `(Num (numop ${NUMOP_CODES[op]} (tonum ${a}) (tonum ${b})))`;
          default:
            // "in", "instanceof" and anything else fall through to leafFacts (retaining BooleanValue / ValuesDomain).
            return undefined;
        }
      }
      default:
        return undefined;
    }
  }

  // ToPrimitive: objects become a deterministic opaque primitive, everything else is unchanged.
  toPrimitive(v: Value, t: string, fn: "objprim" | "objprim_num" = "objprim"): string {
    if (v instanceof ConcreteValue && !(v instanceof ObjectValue)) return t;
    if (v instanceof AbstractValue && !v.mightBeObject()) return t;
    let key = `${fn}:${t}`;
    if (!this.primAsserted.has(key)) {
      this.primAsserted.add(key);
      this.decls.push(`(assert (not (or ((_ is Obj) (${fn} ${t})) ((_ is Empty) (${fn} ${t})))))`);
    }
    return `(ite ((_ is Obj) ${t}) (${fn} ${t}) ${t})`;
  }

  // Facts Prepack's domains establish about an opaque abstract value.
  leafFacts(v: AbstractValue, name: string, depth: number): Array<string> {
    let facts = [];
    if (v.kind === "abstractConcreteUnion" && v.args.length > 0) {
      let alts = v.args.map(a => `(same ${name} ${this.term(a, depth)})`);
      facts.push(`(or ${alts.join(" ")})`);
      return facts;
    }
    let type = v.getType();
    let tags = tagsOfType(type);
    if (!v.mightBeEmpty) tags = tags.filter(t => t !== "Empty");
    if (tags.length < ALL_TAGS.length) facts.push(`(or ${tags.map(t => `((_ is ${t}) ${name})`).join(" ")})`);
    // IntegralValue is not asserted: Prepack types e.g. integer additions as integral even when they overflow.
    if (Value.isTypeCompatibleWith(type, FunctionValue)) facts.push(`(callable (jo ${name}))`);
    if (!v.values.isTop()) {
      let elements = Array.from(v.values.getElements());
      let alts = elements.map(e => `(same ${name} ${this.concrete(e)})`);
      if (v.mightBeEmpty) alts.push(`((_ is Empty) ${name})`);
      facts.push(alts.length === 0 ? "false" : `(or ${alts.join(" ")})`);
    }
    return facts;
  }

  sameArgs(a: Array<Value>, b: Array<Value>, depth: number): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!a[i].equals(b[i]) && this.term(a[i], depth) !== this.term(b[i], depth)) return false;
    }
    return true;
  }
}

// Identifies pure operations that dischargeValuesFromUnion may duplicate into a temporal `_$...`.
function pureOperationSpec(v: AbstractValue): void | [OperationDescriptor, Array<Value>] {
  let entry = v.$Realm.getTemporalOperationEntryFromDerivedValue(v);
  if (entry !== undefined) {
    return entry.isPure === true ? [entry.operationDescriptor, entry.args] : undefined;
  }
  if (v.operationDescriptor !== undefined) {
    return [v.operationDescriptor, v.args];
  }
  return undefined;
}

function samePureDescriptor(a: OperationDescriptor, b: OperationDescriptor): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.type === "ABSTRACT_PROPERTY") return true;
  if (a.type === "ABSTRACT_FROM_TEMPLATE") return a.data.templateSource === b.data.templateSource;
  if (a.type === "IDENTIFIER") return a.data.id === b.data.id;
  return false;
}

function operatorKindOf(od: OperationDescriptor): void | any {
  if (od.type === "BINARY_EXPRESSION") return od.data.binaryOperator;
  if (od.type === "LOGICAL_EXPRESSION") return od.data.logicalOperator;
  if (od.type === "UNARY_EXPRESSION") return od.data.unaryOperator;
  if (od.type === "CONDITIONAL_EXPRESSION") return "conditional";
  return undefined;
}

// Multiplication of a symbolic `N` term by a concrete JS number `k` (keeps multiplication linear for Z3).
function constMul(k: number, nTerm: string): string {
  if (Number.isNaN(k)) return "NaN";
  if (k === 0) return `(ite (or ((_ is NaN) ${nTerm}) ((_ is PInf) ${nTerm}) ((_ is NInf) ${nTerm})) NaN pz)`;
  if (k === Infinity) {
    return `(ite (or ((_ is NaN) ${nTerm}) (nzero ${nTerm})) NaN (ite (nlt ${nTerm} pz) NInf PInf))`;
  }
  if (k === -Infinity) {
    return `(ite (or ((_ is NaN) ${nTerm}) (nzero ${nTerm})) NaN (ite (nlt ${nTerm} pz) PInf NInf))`;
  }
  let kReal = realLiteral(k);
  let posInf = k > 0 ? "PInf" : "NInf";
  let negInf = k > 0 ? "NInf" : "PInf";
  return `(ite ((_ is NaN) ${nTerm}) NaN (ite ((_ is PInf) ${nTerm}) ${posInf} (ite ((_ is NInf) ${nTerm}) ${negInf} (Fin (* ${kReal} (fv ${nTerm}))))))`;
}

const ALL_TAGS = ["Num", "Bool", "Str", "Undef", "Null", "Obj", "Sym", "Empty"];

function tagsOfType(type: typeof Value): Array<string> {
  if (Value.isTypeCompatibleWith(type, NumberValue)) return ["Num"];
  if (type === StringValue) return ["Str"];
  if (type === BooleanValue) return ["Bool"];
  if (type === SymbolValue) return ["Sym"];
  if (type === NullValue) return ["Null"];
  if (type === EmptyValue) return ["Empty"];
  if (type === UndefinedValue) return ["Undef"];
  if (Value.isTypeCompatibleWith(type, ObjectValue)) return ["Obj"];
  if (type === PrimitiveValue) return ["Num", "Bool", "Str", "Undef", "Null", "Sym", "Empty"];
  return ALL_TAGS;
}

function realLiteral(x: number): string {
  if (x === 0) return "0.0";
  // |x| = m * 2^e with m an integer below 2^53 (all steps are exact)
  let m = Math.abs(x);
  let e = 0;
  while (!Number.isInteger(m)) {
    m *= 2;
    e--;
  }
  while (m >= 9007199254740992) {
    m /= 2;
    e++;
  }
  let r = e >= 0 ? `${timesPowerOfTwo(m, e)}.0` : `(/ ${m}.0 ${timesPowerOfTwo(1, -e)}.0)`;
  return x < 0 ? `(- ${r})` : r;
}

// A JS number as an exact `N` term (doubles are dyadic rationals).
export function numberLiteral(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "PInf";
  if (x === -Infinity) return "NInf";
  return `(Fin ${realLiteral(x)})`;
}

// Decimal string of m * 2^e for a safe integer m, without BigInt.
function timesPowerOfTwo(m: number, e: number): string {
  let digits = String(m)
    .split("")
    .reverse()
    .map(Number);
  for (let i = 0; i < e; i++) {
    let carry = 0;
    for (let j = 0; j < digits.length; j++) {
      let d = digits[j] * 2 + carry;
      digits[j] = d % 10;
      carry = d >= 10 ? 1 : 0;
    }
    if (carry) digits.push(1);
  }
  return digits.reverse().join("");
}

// SMT-LIB 2.6 string literal; one Z3 character per UTF-16 code unit.
export function stringLiteral(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c === 0x22) out += '""';
    else if (c >= 0x20 && c < 0x7f && c !== 0x5c) out += s[i];
    else out += `\\u{${c.toString(16)}}`;
  }
  return out + '"';
}

// A short human-readable rendering of a value, used in counterexample reports.
export function describe(v: Value, depth: number = 0): string {
  if (v instanceof EmptyValue) return "<empty>";
  if (v instanceof StringValue) return JSON.stringify(v.value);
  if (v instanceof NumberValue) return Object.is(v.value, -0) ? "-0" : String(v.value);
  if (v instanceof PrimitiveValue) return v.toDisplayString();
  if (v instanceof ObjectValue) return v.intrinsicName || `<object>`;
  if (!(v instanceof AbstractValue)) return "?";
  if (v.intrinsicName !== undefined) return v.intrinsicName;
  let od = v.operationDescriptor;
  if (od !== undefined && od.type === "IDENTIFIER" && od.data.id !== undefined) return od.data.id;
  if (depth > 6) return "…";
  let a = v.args.map(x => describe(x, depth + 1));
  let kind = v.kind;
  if (od !== undefined) {
    if (od.type === "CONDITIONAL_EXPRESSION") return `(${a[0]} ? ${a[1]} : ${a[2]})`;
    if (od.type === "LOGICAL_EXPRESSION" || od.type === "BINARY_EXPRESSION") return `(${a[0]} ${String(kind)} ${a[1]})`;
    if (od.type === "UNARY_EXPRESSION")
      return kind === "typeof" || kind === "void" ? `(${kind} ${a[0]})` : `${String(kind)}${a[0]}`;
  }
  return `${String(kind)}(${a.join(", ")})`;
}
