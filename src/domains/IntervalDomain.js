/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { BabelBinaryOperator } from "@babel/types";
import type { OperationDescriptor } from "../utils/generator.js";
import invariant from "../invariant.js";
import { Path } from "../singletons.js";
import { PathConditionsImplementation } from "../utils/paths.js";
import {
  AbstractValue,
  BooleanValue,
  ConcreteValue,
  NullValue,
  NumberValue,
  StringValue,
  UndefinedValue,
  Value,
} from "../values/index.js";

/* A numeric interval domain. An interval describes the set of numbers an abstract value
   (whose type is known to be number) may take at runtime:
     - every non-NaN value v satisfies lo <= v <= hi (-0 is treated as +0 for the bounds),
     - integral: every non-NaN value is a finite integer,
     - mayBeNaN / mayBeNegZero: whether NaN / -0 are possible.
   Intervals are not stored on abstract values. They are derived on demand from the structure
   of the value (its values domain, its kind and its arguments) and cached per value, which
   keeps them sound under joins and widening: whatever produced the value also produced its
   arguments, so the derivation only depends on immutable information.

   A solver (track 1B) can refine intervals later via IntervalDomain.refinementHook, which is
   consulted after the structural derivation and may only return a sub-interval. */

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const UINT32_MAX = 4294967295;
export const MAX_SAFE_LENGTH = 9007199254740991; // 2^53 - 1
const MAX_DEPTH = 12;

export default class IntervalDomain {
  constructor(lo: number, hi: number, integral: boolean, mayBeNaN: boolean, mayBeNegZero: boolean) {
    invariant(lo <= hi || (lo !== lo && hi !== hi), "empty or malformed interval");
    this.lo = lo;
    this.hi = hi;
    this.integral = integral && isFinite(lo) && isFinite(hi);
    this.mayBeNaN = mayBeNaN;
    this.mayBeNegZero = mayBeNegZero && lo <= 0 && hi >= 0;
  }

  lo: number;
  hi: number;
  integral: boolean;
  mayBeNaN: boolean;
  mayBeNegZero: boolean;

  static top: IntervalDomain;
  static int32: IntervalDomain;
  static uint32: IntervalDomain;
  static arrayLength: IntervalDomain;

  // Optional refinement hook (e.g. an SMT solver). Must return an interval contained in the given one.
  static refinementHook: void | ((value: AbstractValue, interval: IntervalDomain) => IntervalDomain);

  static point(n: number): IntervalDomain {
    if (n !== n) return new IntervalDomain(NaN, NaN, false, true, false);
    return new IntervalDomain(n, n, Number.isInteger(n), false, Object.is(n, -0));
  }

  static integers(lo: number, hi: number): IntervalDomain {
    return new IntervalDomain(lo, hi, true, false, false);
  }

  // Returns true if the interval contains no non-NaN values (i.e. it only describes NaN).
  isOnlyNaN(): boolean {
    return this.lo !== this.lo;
  }

  join(other: IntervalDomain): IntervalDomain {
    if (this.isOnlyNaN()) return new IntervalDomain(other.lo, other.hi, other.integral, true, other.mayBeNegZero);
    if (other.isOnlyNaN()) return new IntervalDomain(this.lo, this.hi, this.integral, true, this.mayBeNegZero);
    return new IntervalDomain(
      Math.min(this.lo, other.lo),
      Math.max(this.hi, other.hi),
      this.integral && other.integral,
      this.mayBeNaN || other.mayBeNaN,
      this.mayBeNegZero || other.mayBeNegZero
    );
  }

  meet(other: IntervalDomain): IntervalDomain {
    if (this.isOnlyNaN() || other.isOnlyNaN()) return this.isOnlyNaN() ? this : other;
    let lo = Math.max(this.lo, other.lo);
    let hi = Math.min(this.hi, other.hi);
    let integral = this.integral || other.integral;
    if (integral) {
      lo = Math.ceil(lo);
      hi = Math.floor(hi);
    }
    // An empty meet means the value can only be NaN (or the path is infeasible); stay conservative.
    if (!(lo <= hi)) return this;
    return new IntervalDomain(
      lo,
      hi,
      integral,
      this.mayBeNaN && other.mayBeNaN,
      this.mayBeNegZero && other.mayBeNegZero
    );
  }

  // The number of distinct values (NaN counted as a value), or Infinity if the interval is not integral.
  size(): number {
    if (this.isOnlyNaN()) return 1;
    if (!this.integral) return this.lo === this.hi && !this.mayBeNegZero ? 1 + (this.mayBeNaN ? 1 : 0) : Infinity;
    return this.hi - this.lo + 1 + (this.mayBeNaN ? 1 : 0) + (this.mayBeNegZero ? 1 : 0);
  }

  toString(): string {
    return `[${this.lo}, ${this.hi}]${this.integral ? "i" : ""}${this.mayBeNaN ? "+NaN" : ""}${
      this.mayBeNegZero ? "+-0" : ""
    }`;
  }

  // The interval of ToInt32(x) for any x in this interval.
  toInt32(): IntervalDomain {
    if (this.isOnlyNaN()) return IntervalDomain.point(0);
    let lo = Math.trunc(this.lo);
    let hi = Math.trunc(this.hi);
    if (!(lo >= INT32_MIN && hi <= INT32_MAX)) return IntervalDomain.int32;
    // NaN maps to 0, -0 maps to +0.
    if (this.mayBeNaN) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    return IntervalDomain.integers(lo === 0 ? 0 : lo, hi === 0 ? 0 : hi);
  }

  // Ask whether `this op other` is always true / always false. Returns undefined if unknown.
  static compare(op: BabelBinaryOperator, a: IntervalDomain, b: IntervalDomain): void | boolean {
    let mayBeNaN = a.mayBeNaN || b.mayBeNaN;
    if (a.isOnlyNaN() || b.isOnlyNaN()) {
      if (op === "!==" || op === "!=") return true;
      return false;
    }
    switch (op) {
      case "<":
        if (a.hi < b.lo && !mayBeNaN) return true;
        if (a.lo >= b.hi) return false;
        return undefined;
      case "<=":
        if (a.hi <= b.lo && !mayBeNaN) return true;
        if (a.lo > b.hi) return false;
        return undefined;
      case ">":
        return IntervalDomain.compare("<", b, a);
      case ">=":
        return IntervalDomain.compare("<=", b, a);
      case "===":
      case "==":
        if (a.hi < b.lo || b.hi < a.lo) return false;
        // Non-integral intervals of a single point can still only contain that point (and NaN).
        if (a.lo === a.hi && b.lo === b.hi && a.lo === b.lo && !mayBeNaN) return true;
        return undefined;
      case "!==":
      case "!=": {
        let eq = IntervalDomain.compare("===", a, b);
        return eq === undefined ? undefined : !eq;
      }
      default:
        return undefined;
    }
  }

  // Returns the interval of a value that is known to be a number, or undefined if the value
  // might not be a number.
  // The interval takes the current path conditions into account.
  static of(value: Value): void | IntervalDomain {
    let result = derive(value, 0);
    if (result === undefined || !(value instanceof AbstractValue)) return result;
    return refineWithPathConditions(value, result);
  }

  // Records how a derived (temporal) value was computed, so that its interval can be derived
  // from its operands like that of the equivalent non-temporal value.
  static noteDerivation(value: AbstractValue, args: Array<Value>, operationDescriptor: OperationDescriptor): void {
    if (operationDescriptor.type === "BINARY_EXPRESSION") derivations.set(value, { args, operationDescriptor });
  }

  // Returns the interval of ToNumber(value) for primitive values whose conversion is pure.
  static ofToNumber(value: Value): IntervalDomain {
    return deriveToNumber(value, 0);
  }

  // If value is a number that can only take a few values, return them (at most limit).
  // NaN is never part of the result: callers get undefined if NaN is possible.
  // If ignoreNegZero is true, -0 may be represented by +0 (for callers that only use the number
  // as a length or index); otherwise undefined is returned when -0 is possible.
  static enumerate(value: Value, limit: number, ignoreNegZero: boolean): void | Array<number> {
    if (value instanceof NumberValue) return [value.value];
    if (!(value instanceof AbstractValue) || value.mightNotBeNumber()) return undefined;
    if (!value.values.isTop()) {
      let range = IntervalDomain.of(value);
      let result = [];
      for (let v of value.values.getElements()) {
        if (!(v instanceof NumberValue)) return undefined;
        let n = v.value;
        if (n !== n) return undefined;
        if (Object.is(n, -0)) {
          if (!ignoreNegZero) return undefined;
          n = 0;
        }
        // Drop values that the path conditions rule out.
        if (range !== undefined && !range.isOnlyNaN() && (n < range.lo || n > range.hi)) continue;
        if (result.indexOf(n) < 0) result.push(n);
      }
      if (result.length > limit) return undefined;
      return result;
    }
    let range = IntervalDomain.of(value);
    if (range === undefined || !range.integral || range.mayBeNaN || (range.mayBeNegZero && !ignoreNegZero))
      return undefined;
    if (range.hi - range.lo + 1 > limit) return undefined;
    let result = [];
    for (let n = range.lo; n <= range.hi; n++) result.push(n);
    return result;
  }

  // If value can only be one of a few strings or numbers (no NaN), return those values, for use as
  // property keys. -0 is represented by +0, which is the same property key.
  static enumeratePropertyKeys(value: AbstractValue, limit: number): void | Array<NumberValue | StringValue> {
    let realm = value.$Realm;
    if (!value.mightNotBeNumber()) {
      let numbers = IntervalDomain.enumerate(value, limit, true);
      return numbers === undefined ? undefined : numbers.map(n => new NumberValue(realm, n));
    }
    if (value.values.isTop()) return undefined;
    let result = [];
    for (let v of value.values.getElements()) {
      if (v instanceof StringValue) result.push(v);
      else if (v instanceof NumberValue && v.value === v.value)
        result.push(new NumberValue(realm, v.value === 0 ? 0 : v.value));
      else return undefined;
    }
    return result.length <= limit ? result : undefined;
  }
}

IntervalDomain.top = new IntervalDomain(-Infinity, Infinity, false, true, true);
IntervalDomain.int32 = IntervalDomain.integers(INT32_MIN, INT32_MAX);
IntervalDomain.uint32 = IntervalDomain.integers(0, UINT32_MAX);
IntervalDomain.arrayLength = IntervalDomain.integers(0, MAX_SAFE_LENGTH);

const MAX_PATH_CONDITIONS = 64;

// Meets the interval with facts of the form `value op constant` found in the path conditions,
// and picks the branch of a conditional value whose condition is implied by the path.
function refineWithPathConditions(value: AbstractValue, interval: IntervalDomain): IntervalDomain {
  let realm = value.$Realm;
  if (value.kind === "conditional") {
    let [c, x, y] = value.args;
    let branch = Path.implies(c) ? x : Path.impliesNot(c) ? y : undefined;
    if (branch !== undefined) {
      let branchInterval = IntervalDomain.of(branch);
      if (branchInterval !== undefined) interval = interval.meet(branchInterval);
    }
  }
  let pc = realm.pathConditions;
  let count = 0;
  while (pc instanceof PathConditionsImplementation && count < MAX_PATH_CONDITIONS) {
    for (let condition of pc.getAssumedConditions()) {
      if (++count > MAX_PATH_CONDITIONS) break;
      let fact = factAbout(value, condition, interval.integral);
      if (fact !== undefined) interval = interval.meet(fact);
    }
    pc = pc._baseConditions;
  }
  return interval;
}

const flippedOperator = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "===": "===", "==": "==" };
const negatedOperator = { "<": ">=", "<=": ">", ">": "<=", ">=": "<", "!==": "===", "!=": "==" };

// If condition (assumed true) constrains value against a number constant, return the constraint.
// If integral is true, value is known to be an integer, so strict bounds can be tightened.
function factAbout(value: AbstractValue, condition: AbstractValue, integral: boolean): void | IntervalDomain {
  let op = condition.kind;
  let negated = false;
  if (op === "!") {
    let inner = condition.args[0];
    if (!(inner instanceof AbstractValue)) return undefined;
    condition = inner;
    op = inner.kind;
    negated = true;
  }
  if (typeof op !== "string" || condition.args.length !== 2) return undefined;
  let [x, y] = condition.args;
  let k;
  if (x instanceof NumberValue && y instanceof AbstractValue && (y === value || y.equals(value))) {
    k = x.value;
    op = flippedOperator[op];
  } else if (y instanceof NumberValue && x instanceof AbstractValue && (x === value || x.equals(value))) {
    k = y.value;
  } else {
    return undefined;
  }
  if (op === undefined || k !== k) return undefined;
  // A negated relational comparison also holds for NaN, so NaN stays possible.
  let mayBeNaN = false;
  if (negated) {
    op = negatedOperator[op];
    if (op === undefined) return undefined;
    mayBeNaN = op !== "===" && op !== "==";
  }
  // value is known to be a number, so == behaves like ===.
  switch (op) {
    case "===":
    case "==":
      return new IntervalDomain(k, k, Number.isInteger(k), false, k === 0);
    case "<":
      return new IntervalDomain(-Infinity, integral ? Math.ceil(k) - 1 : k, false, mayBeNaN, true);
    case "<=":
      return new IntervalDomain(-Infinity, integral ? Math.floor(k) : k, false, mayBeNaN, true);
    case ">":
      return new IntervalDomain(integral ? Math.floor(k) + 1 : k, Infinity, false, mayBeNaN, true);
    case ">=":
      return new IntervalDomain(integral ? Math.ceil(k) : k, Infinity, false, mayBeNaN, true);
    default:
      return undefined;
  }
}

const cache: WeakMap<AbstractValue, IntervalDomain | null> = new WeakMap();
const derivations: WeakMap<AbstractValue, { args: Array<Value>, operationDescriptor: OperationDescriptor }> = new WeakMap();

function derive(value: Value, depth: number): void | IntervalDomain {
  if (value instanceof NumberValue) return IntervalDomain.point(value.value);
  if (!(value instanceof AbstractValue) || value.mightNotBeNumber()) return undefined;
  let cached = cache.get(value);
  if (cached !== undefined) return cached === null ? undefined : cached;
  let result = depth > MAX_DEPTH ? IntervalDomain.top : deriveAbstract(value, depth);
  let hook = IntervalDomain.refinementHook;
  if (hook !== undefined && result !== IntervalDomain.top) result = hook(value, result);
  if (depth <= MAX_DEPTH) cache.set(value, result);
  return result;
}

function deriveToNumber(value: Value, depth: number): IntervalDomain {
  if (value instanceof BooleanValue) return IntervalDomain.point(value.value ? 1 : 0);
  if (value instanceof NullValue) return IntervalDomain.point(0);
  if (value instanceof UndefinedValue) return IntervalDomain.point(NaN);
  if (value instanceof AbstractValue && value.getType() === BooleanValue) return IntervalDomain.integers(0, 1);
  return derive(value, depth) || IntervalDomain.top;
}

function fromValuesDomain(value: AbstractValue): void | IntervalDomain {
  if (value.values.isTop()) return undefined;
  let result;
  for (let v of value.values.getElements()) {
    if (!(v instanceof NumberValue)) return undefined;
    let p = IntervalDomain.point(v.value);
    result = result === undefined ? p : result.join(p);
  }
  return result;
}

function deriveAbstract(value: AbstractValue, depth: number): IntervalDomain {
  let fromValues = fromValuesDomain(value);
  if (fromValues !== undefined) return fromValues;
  let args = value.args;
  let kind = value.kind;
  // Temporal binary expressions (whose operands might have side effecting conversions) are
  // derived values; if they produce a value, it is the same as that of the plain expression.
  let derivation = derivations.get(value);
  if (derivation !== undefined) {
    args = derivation.args;
    kind = derivation.operationDescriptor.data.binaryOperator;
  }
  let d = depth + 1;
  switch (kind) {
    case "conditional": {
      let a = derive(args[1], d);
      let b = derive(args[2], d);
      if (a === undefined || b === undefined) return IntervalDomain.top;
      return a.join(b);
    }
    case "+":
    case "-":
    case "*": {
      if (args.length !== 2) {
        // Unary minus and plus use the operator as kind as well.
        let operand = deriveToNumber(args[0], d);
        return kind === "-" ? negate(operand) : kind === "+" ? operand : IntervalDomain.top;
      }
      let [x, y] = args;
      if (!isPrimitiveNonString(x) || !isPrimitiveNonString(y)) return IntervalDomain.top;
      return arithmetic(kind, deriveToNumber(x, d), deriveToNumber(y, d));
    }
    case "%":
      return remainder(deriveToNumber(args[0], d), deriveToNumber(args[1], d));
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
    case ">>>":
      return bitwise(kind, deriveToNumber(args[0], d).toInt32(), deriveToNumber(args[1], d).toInt32());
    case "~":
      return IntervalDomain.int32;
    case "(A).length":
      return IntervalDomain.arrayLength;
    default:
      if (typeof kind === "string" && kind.startsWith("template:global.Math.")) {
        let match = /^template:global\.Math\.(\w+)\(/.exec(kind);
        if (match) return mathFunction(match[1], args.map(a => deriveToNumber(a, d)));
      }
      return IntervalDomain.top;
  }
}

function isPrimitiveNonString(v: Value): boolean {
  if (v instanceof ConcreteValue)
    return (
      v instanceof NumberValue || v instanceof BooleanValue || v instanceof NullValue || v instanceof UndefinedValue
    );
  invariant(v instanceof AbstractValue);
  let t = v.getType();
  return Value.isTypeCompatibleWith(t, NumberValue) || t === BooleanValue;
}

function negate(a: IntervalDomain): IntervalDomain {
  if (a.isOnlyNaN()) return a;
  return new IntervalDomain(-a.hi, -a.lo, a.integral, a.mayBeNaN, a.lo <= 0 && a.hi >= 0);
}

function arithmetic(op: "+" | "-" | "*", a: IntervalDomain, b: IntervalDomain): IntervalDomain {
  if (a.isOnlyNaN() || b.isOnlyNaN()) return IntervalDomain.point(NaN);
  if (op === "-") return arithmetic("+", a, negate(b));
  let candidates = op === "+" ? [a.lo + b.lo, a.hi + b.hi] : [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  let mayBeNaN = a.mayBeNaN || b.mayBeNaN || candidates.some(c => c !== c);
  // Infinity - Infinity or 0 * Infinity: the operands can produce NaN, give up on bounds.
  if (candidates.some(c => c !== c)) return IntervalDomain.top;
  let lo = Math.min(...candidates);
  let hi = Math.max(...candidates);
  let integral = a.integral && b.integral && isFinite(lo) && isFinite(hi);
  // Sums of integers beyond 2^53 are still integers, but they might be rounded; bounds stay sound
  // because rounding is monotone. -0 arises from -0 + -0, or from multiplying zero by a negative number.
  let mayBeNegZero = op === "+" ? a.mayBeNegZero && b.mayBeNegZero : lo <= 0 && hi >= 0;
  return new IntervalDomain(lo, hi, integral, mayBeNaN, mayBeNegZero);
}

function remainder(a: IntervalDomain, b: IntervalDomain): IntervalDomain {
  if (a.isOnlyNaN() || b.isOnlyNaN()) return IntervalDomain.point(NaN);
  if (!a.integral || !b.integral) return IntervalDomain.top;
  let mayBeNaN = a.mayBeNaN || b.mayBeNaN || (b.lo <= 0 && b.hi >= 0);
  let m = Math.min(Math.max(Math.abs(b.lo), Math.abs(b.hi)) - 1, Math.max(Math.abs(a.lo), Math.abs(a.hi)));
  if (m < 0) m = 0;
  let lo = a.lo < 0 ? -m : 0;
  let hi = a.hi > 0 ? m : 0;
  return new IntervalDomain(lo, hi, true, mayBeNaN, a.lo < 0 || a.mayBeNegZero);
}

function bitwise(op: string, a: IntervalDomain, b: IntervalDomain): IntervalDomain {
  // a and b are ToInt32 intervals here.
  switch (op) {
    case "&":
      if (a.lo >= 0 && b.lo >= 0) return IntervalDomain.integers(0, Math.min(a.hi, b.hi));
      if (a.lo >= 0) return IntervalDomain.integers(0, a.hi);
      if (b.lo >= 0) return IntervalDomain.integers(0, b.hi);
      return IntervalDomain.int32;
    case "|":
      if (b.lo === 0 && b.hi === 0) return a;
      if (a.lo === 0 && a.hi === 0) return b;
      if (a.lo >= 0 && b.lo >= 0)
        return IntervalDomain.integers(Math.max(a.lo, b.lo), allOnesAbove(Math.max(a.hi, b.hi)));
      return IntervalDomain.int32;
    case "^":
      if (a.lo >= 0 && b.lo >= 0) return IntervalDomain.integers(0, allOnesAbove(Math.max(a.hi, b.hi)));
      return IntervalDomain.int32;
    case ">>":
      if (b.lo === b.hi) {
        let s = b.lo & 31;
        return IntervalDomain.integers(a.lo >> s, a.hi >> s);
      }
      return IntervalDomain.int32;
    case ">>>":
      if (b.lo === b.hi && a.lo >= 0) {
        let s = b.lo & 31;
        return IntervalDomain.integers(a.lo >>> s, a.hi >>> s);
      }
      return IntervalDomain.uint32;
    default:
      return IntervalDomain.int32;
  }
}

// The smallest number of the form 2^k - 1 that is >= n (n >= 0).
function allOnesAbove(n: number): number {
  let r = 0;
  while (r < n) r = r * 2 + 1;
  return r;
}

function mathFunction(name: string, args: Array<IntervalDomain>): IntervalDomain {
  let anyNaN = args.some(a => a.mayBeNaN);
  if (args.some(a => a.isOnlyNaN())) return IntervalDomain.point(NaN);
  switch (name) {
    case "min":
    case "max": {
      if (args.length === 0) return IntervalDomain.top;
      let f = name === "min" ? Math.min : Math.max;
      return new IntervalDomain(
        f(...args.map(a => a.lo)),
        f(...args.map(a => a.hi)),
        args.every(a => a.integral),
        anyNaN,
        args.some(a => a.mayBeNegZero) || (args.some(a => a.lo <= 0) && args.some(a => a.hi >= 0))
      );
    }
    case "abs": {
      if (args.length === 0) return IntervalDomain.point(NaN);
      let a = args[0];
      let lo = a.lo >= 0 ? a.lo : a.hi <= 0 ? -a.hi : 0;
      let hi = Math.max(Math.abs(a.lo), Math.abs(a.hi));
      return new IntervalDomain(lo, hi, a.integral, a.mayBeNaN, false);
    }
    case "floor":
    case "ceil":
    case "round":
    case "trunc": {
      if (args.length === 0) return IntervalDomain.point(NaN);
      let a = args[0];
      let f = Math[name];
      let lo = f(a.lo);
      let hi = f(a.hi);
      return new IntervalDomain(
        lo,
        hi,
        isFinite(lo) && isFinite(hi),
        a.mayBeNaN,
        a.mayBeNegZero || (a.lo < 1 && a.hi > -1)
      );
    }
    case "sign": {
      if (args.length === 0) return IntervalDomain.point(NaN);
      let a = args[0];
      return new IntervalDomain(Math.sign(a.lo), Math.sign(a.hi), true, a.mayBeNaN, a.mayBeNegZero);
    }
    case "clz32":
      return IntervalDomain.integers(0, 32);
    default:
      return IntervalDomain.top;
  }
}
