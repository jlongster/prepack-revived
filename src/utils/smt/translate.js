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
// Numbers are `N`: (Fin Real) | NaN | PInf | NInf. Constants are exact rationals, comparisons, equality, NaN and the
// infinities are exact. -0 is identified with +0 (fine for ===, ==, <, ToBoolean; Object.is and 1/x are not
// modelled precisely). Arithmetic (+ - * / % ** and bitwise operators) is deliberately *uninterpreted*: real
// arithmetic would be unsound for rounding and overflow, and IEEE (FloatingPoint 11 53) arithmetic made typical
// queries 100-1000x slower in measurements. Arithmetic results are therefore opaque but consistent (same operator on
// the same operands gives the same result).
// Strings are Z3 strings with one character per UTF-16 code unit, so length and ordering match JS.
//
// Soundness rule: anything this module does not model precisely becomes an *opaque* term: a fresh constant
// (or an uninterpreted function where the JS operation is deterministic). An opaque term is only constrained by
// facts Prepack itself relies on (its TypesDomain / ValuesDomain), never by guesses. Opaque terms are keyed by
// Prepack's own structural equality (AbstractValue.equals), so values Prepack treats as identical stay identical.

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
(define-fun pz () N (Fin 0.0))
(define-fun one () N (Fin 1.0))
(define-fun nzero ((n N)) Bool (and ((_ is Fin) n) (= (fv n) 0.0)))
(define-fun nneg ((n N)) N (ite ((_ is Fin) n) (Fin (- (fv n))) (ite ((_ is PInf) n) NInf (ite ((_ is NInf) n) PInf NaN))))
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
(define-fun tonum ((v JS) (o N)) N
  (ite ((_ is Num) v) (jn v)
  (ite ((_ is Bool) v) (ite (jb v) one pz)
  (ite ((_ is Str) v) (strnum (js v))
  (ite ((_ is Null) v) pz
  (ite (or ((_ is Obj) v) ((_ is Sym) v)) o NaN))))))
(define-fun tostr ((v JS) (o String)) String
  (ite ((_ is Str) v) (js v)
  (ite ((_ is Num) v) (numstr (jn v))
  (ite ((_ is Bool) v) (ite (jb v) "true" "false")
  (ite ((_ is Undef) v) "undefined"
  (ite ((_ is Null) v) "null" o))))))
(define-fun seq ((a JS) (b JS)) Bool
  (ite (and ((_ is Num) a) ((_ is Num) b)) (neq (jn a) (jn b)) (= a b)))
(define-fun same ((a JS) (b JS)) Bool (= a b))
(define-fun numlike ((v JS)) Bool (or ((_ is Num) v) ((_ is Str) v) ((_ is Bool) v)))
(define-fun leq ((a JS) (b JS) (o Bool)) Bool
  (ite (or ((_ is Empty) a) ((_ is Empty) b)) (= a b)
  (ite (and (nullish a) (nullish b)) true
  (ite (or (nullish a) (nullish b)) false
  (ite (and ((_ is Str) a) ((_ is Str) b)) (= a b)
  (ite (and (numlike a) (numlike b)) (neq (tonum a pz) (tonum b pz))
  (ite (and ((_ is Obj) a) ((_ is Obj) b)) (= a b)
  (ite (and ((_ is Sym) a) ((_ is Sym) b)) (= a b)
  (ite (or ((_ is Obj) a) ((_ is Obj) b)) o
  false)))))))))
(define-fun opaquecmp ((a JS) (b JS)) Bool
  (or ((_ is Obj) a) ((_ is Obj) b) ((_ is Sym) a) ((_ is Sym) b)))
(define-fun jlt ((a JS) (b JS) (o Bool)) Bool
  (ite (opaquecmp a b) o
  (ite (and ((_ is Str) a) ((_ is Str) b)) (str.< (js a) (js b))
  (nlt (tonum a pz) (tonum b pz)))))
(define-fun jle ((a JS) (b JS) (o Bool)) Bool
  (ite (opaquecmp a b) o
  (ite (and ((_ is Str) a) ((_ is Str) b)) (str.<= (js a) (js b))
  (nle (tonum a pz) (tonum b pz)))))
(define-fun jadd ((a JS) (b JS) (os String)) JS
  (ite (or ((_ is Str) a) ((_ is Str) b))
    (Str (str.++ (tostr a os) (tostr b os)))
    (Num (numop 0 (tonum a pz) (tonum b pz)))))
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
  "+": 0,
  "-": 10,
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
  constructor(maxNodes: number = 4000) {
    this.decls = [];
    this.buckets = new Map();
    this.objIds = new Map();
    this.counter = 0;
    this.nodes = 0;
    this.maxNodes = maxNodes;
    this.leaves = [];
    this.numConsts = new Map();
    this.strConsts = new Set();
  }

  decls: Array<string>;
  buckets: Map<number, Array<[AbstractValue, string]>>;
  objIds: Map<ConcreteValue, number>;
  counter: number;
  nodes: number;
  maxNodes: number;
  leaves: Array<Leaf>;
  numConsts: Map<string, string>;
  strConsts: Set<string>;

  fresh(prefix: string, sort: string): string {
    let name = `${prefix}${this.counter++}`;
    this.decls.push(`(declare-const ${name} ${sort})`);
    return name;
  }

  truthy(v: Value): string {
    if (v instanceof ConcreteValue) return v.mightNotBeTrue() ? "false" : "true";
    return `(truthy ${this.term(v)})`;
  }

  // The script (declarations, definitions and background facts) needed by the terms produced so far.
  script(): string {
    return this.decls.join("\n");
  }

  term(v: Value): string {
    if (v instanceof ConcreteValue) return this.concrete(v);
    if (!(v instanceof AbstractValue)) throw new TranslationError("unexpected value");
    let bucket = this.buckets.get(v.hashValue);
    if (bucket === undefined) this.buckets.set(v.hashValue, (bucket = []));
    for (let [w, name] of bucket) if (w === v || w.equals(v)) return name;
    if (++this.nodes > this.maxNodes) throw new TranslationError("expression too large");
    let compound = this.compound(v);
    let name = `v${this.counter++}`;
    bucket.push([v, name]);
    if (compound !== undefined) {
      this.decls.push(`(define-fun ${name} () JS ${compound})`);
    } else {
      this.decls.push(`(declare-const ${name} JS)`);
      let facts = this.leafFacts(v, name);
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
  compound(v: AbstractValue): void | string {
    let kind = v.kind;
    let od = v.operationDescriptor;
    if (kind === undefined || od === undefined || v.intrinsicName !== undefined) return undefined;
    let args = v.args;
    switch (od.type) {
      case "CONDITIONAL_EXPRESSION": {
        if (kind !== "conditional" || args.length !== 3) return undefined;
        return `(ite ${this.truthy(args[0])} ${this.term(args[1])} ${this.term(args[2])})`;
      }
      case "LOGICAL_EXPRESSION": {
        if (args.length !== 2 || od.data.logicalOperator !== kind) return undefined;
        let a = this.term(args[0]);
        let b = this.term(args[1]);
        if (kind === "&&") return `(ite (truthy ${a}) ${b} ${a})`;
        if (kind === "||") return `(ite (truthy ${a}) ${a} ${b})`;
        return undefined;
      }
      case "UNARY_EXPRESSION": {
        if (args.length !== 1 || od.data.unaryOperator !== kind) return undefined;
        let a = this.term(args[0]);
        switch (kind) {
          case "!":
            return `(Bool (not (truthy ${a})))`;
          case "void":
            return "Undef";
          case "typeof":
            for (let name of ["number", "boolean", "string", "object", "function", "symbol", "undefined"])
              this.string(name);
            return `(Str (jtypeof ${a}))`;
          case "-":
            return `(Num (nneg (tonum ${a} ${this.fresh("n", "N")})))`;
          case "+":
            return `(Num (tonum ${a} ${this.fresh("n", "N")}))`;
          case "~":
            return `(Num (numop ${NUMOP_CODES["~"]} (tonum ${a} ${this.fresh("n", "N")}) pz))`;
          default:
            return undefined;
        }
      }
      case "BINARY_EXPRESSION": {
        if (args.length !== 2 || od.data.binaryOperator !== kind) return undefined;
        let op = kind;
        let a = this.term(args[0]);
        let b = this.term(args[1]);
        switch (op) {
          case "===":
            return `(Bool (seq ${a} ${b}))`;
          case "!==":
            return `(Bool (not (seq ${a} ${b})))`;
          case "==":
            return `(Bool (leq ${a} ${b} ${this.fresh("b", "Bool")}))`;
          case "!=":
            return `(Bool (not (leq ${a} ${b} ${this.fresh("b", "Bool")})))`;
          case "<":
            return `(Bool (jlt ${a} ${b} ${this.fresh("b", "Bool")}))`;
          case "<=":
            return `(Bool (jle ${a} ${b} ${this.fresh("b", "Bool")}))`;
          case ">":
            return `(Bool (jlt ${b} ${a} ${this.fresh("b", "Bool")}))`;
          case ">=":
            return `(Bool (jle ${b} ${a} ${this.fresh("b", "Bool")}))`;
          case "+": {
            let pa = this.toPrimitive(args[0], a);
            let pb = this.toPrimitive(args[1], b);
            return `(jadd ${pa} ${pb} ${this.fresh("s", "String")})`;
          }
          case "-":
          case "*":
          case "/":
          case "%":
          case "**":
          case "&":
          case "|":
          case "^":
          case "<<":
          case ">>":
          case ">>>":
            return `(Num (numop ${NUMOP_CODES[op]} (tonum ${a} ${this.fresh("n", "N")}) (tonum ${b} ${this.fresh(
              "n",
              "N"
            )})))`;
          default:
            // "in", "instanceof" and anything else: an opaque boolean
            return `(Bool ${this.fresh("b", "Bool")})`;
        }
      }
      default:
        return undefined;
    }
  }

  // ToPrimitive: objects become an opaque primitive (user code may run), everything else is unchanged.
  toPrimitive(v: Value, t: string): string {
    if (v instanceof ConcreteValue && !(v instanceof ObjectValue)) return t;
    if (v instanceof AbstractValue && !v.mightBeObject()) return t;
    let p = this.fresh("p", "JS");
    this.decls.push(`(assert (not (or ((_ is Obj) ${p}) ((_ is Empty) ${p}))))`);
    return `(ite ((_ is Obj) ${t}) ${p} ${t})`;
  }

  // Facts Prepack's domains establish about an opaque abstract value.
  leafFacts(v: AbstractValue, name: string): Array<string> {
    let facts = [];
    let type = v.getType();
    let tags = tagsOfType(type);
    if (!v.mightBeEmpty) tags = tags.filter(t => t !== "Empty");
    if (tags.length < ALL_TAGS.length) facts.push(`(or ${tags.map(t => `((_ is ${t}) ${name})`).join(" ")})`);
    // IntegralValue is not asserted: Prepack types e.g. integer additions as integral even when they overflow.
    if (Value.isTypeCompatibleWith(type, FunctionValue)) facts.push(`(callable (jo ${name}))`);
    if (!v.values.isTop()) {
      let elements = Array.from(v.values.getElements());
      if (elements.every(e => !(e instanceof ObjectValue))) {
        let alts = elements.map(e => `(same ${name} ${this.concrete(e)})`);
        if (v.mightBeEmpty) alts.push(`((_ is Empty) ${name})`);
        facts.push(alts.length === 0 ? "false" : `(or ${alts.join(" ")})`);
      }
    }
    return facts;
  }
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

// A JS number as an exact `N` term (doubles are dyadic rationals).
export function numberLiteral(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "PInf";
  if (x === -Infinity) return "NInf";
  if (x === 0) return "(Fin 0.0)";
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
  return `(Fin ${x < 0 ? `(- ${r})` : r})`;
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
