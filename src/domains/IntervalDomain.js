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
   Path-insensitive intervals are derived on demand from the immutable structure of the value
   (its values domain, its kind and its arguments) and cached per value in a WeakMap, which
   keeps them sound under joins and widening. When path conditions are active, IntervalDomain.of
   propagates constraints from the path conditions through compound expressions without mutating
   the path-insensitive cache.

   A solver (track 1B) can refine intervals later via IntervalDomain.refinementHook, which is
   consulted at the end of IntervalDomain.of (outside the path-insensitive cache) and met with
   the derived interval so it may only tighten bounds. */

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const UINT32_MAX = 4294967295;
export const MAX_SAFE_LENGTH = 9007199254740991; // 2^53 - 1
const MAX_DEPTH = 12;

export default class IntervalDomain {
  constructor(lo: number, hi: number, integral: boolean, mayBeNaN: boolean, mayBeNegZero: boolean) {
    invariant(lo <= hi || (Number.isNaN(lo) && Number.isNaN(hi)), "empty or malformed interval");
    this.lo = lo === 0 ? 0 : lo;
    this.hi = hi === 0 ? 0 : hi;
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

  // Optional path-sensitive refinement hook (e.g. an SMT solver from track 1B).
  // Called with (value, currentInterval); its result is met with currentInterval.
  static refinementHook: void | ((value: AbstractValue, interval: IntervalDomain) => IntervalDomain);

  static point(n: number): IntervalDomain {
    if (Number.isNaN(n)) return new IntervalDomain(NaN, NaN, false, true, false);
    return new IntervalDomain(n, n, Number.isInteger(n), false, Object.is(n, -0));
  }

  static integers(lo: number, hi: number): IntervalDomain {
    return new IntervalDomain(lo, hi, true, false, false);
  }

  // Returns true if the interval contains no non-NaN values (i.e. it only describes NaN).
  isOnlyNaN(): boolean {
    return Number.isNaN(this.lo);
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
    if (this.isOnlyNaN()) return this;
    if (other.isOnlyNaN()) return this.mayBeNaN ? other : this;
    let lo = Math.max(this.lo, other.lo);
    let hi = Math.min(this.hi, other.hi);
    let integral = this.integral || other.integral;
    if (integral) {
      lo = Math.ceil(lo);
      hi = Math.floor(hi);
    }
    // An empty numeric intersection means the value can only be NaN, or the path is infeasible.
    if (!(lo <= hi)) return this.mayBeNaN && other.mayBeNaN ? IntervalDomain.point(NaN) : this;
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

  // Ask whether `a op b` is always true / always false for two number intervals. Returns undefined if unknown.
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
        // Single-point intervals (including +/-0) are equal unless NaN is possible.
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
  // might not be a number. Takes the current path conditions into account.
  static of(value: Value): void | IntervalDomain {
    if (value instanceof NumberValue) return IntervalDomain.point(value.value);
    if (!(value instanceof AbstractValue) || value.mightNotBeNumber()) return undefined;
    let hasPath = hasAnyAssumedConditions(value.$Realm.pathConditions);
    let result = hasPath ? deriveWithPath(value, 0, new Map()) : deriveBase(value, 0);
    if (result === undefined) return undefined;
    let hook = IntervalDomain.refinementHook;
    if (hook !== undefined) result = result.meet(hook(value, result));
    return result;
  }

  // Records how a derived (temporal) value was computed, so that its interval can be derived
  // from its operands like that of the equivalent non-temporal value.
  static noteDerivation(value: AbstractValue, args: Array<Value>, operationDescriptor: OperationDescriptor): void {
    let type = operationDescriptor.type;
    if (type === "BINARY_EXPRESSION" || type === "UNARY_EXPRESSION" || type === "ABSTRACT_FROM_TEMPLATE") {
      derivations.set(value, { args, operationDescriptor });
    }
  }

  // Returns the interval of ToNumber(value) for primitive values whose conversion is pure.
  static ofToNumber(value: Value): IntervalDomain {
    return deriveToNumber(value, 0, undefined);
  }

  // If value is a number that can only take a few values, return them (at most limit).
  // NaN is never part of the result: callers get undefined if NaN is possible.
  // If ignoreNegZero is true, -0 may be represented by +0 (for callers that only use the number
  // as a length or index); otherwise undefined is returned when -0 is possible.
  static enumerate(value: Value, limit: number, ignoreNegZero: boolean): void | Array<number> {
    if (value instanceof NumberValue) {
      if (Number.isNaN(value.value)) return undefined;
      if (Object.is(value.value, -0)) return ignoreNegZero ? [0] : undefined;
      return [value.value];
    }
    if (!(value instanceof AbstractValue) || value.mightNotBeNumber()) return undefined;
    if (!value.values.isTop()) {
      let range = IntervalDomain.of(value);
      let result = [];
      for (let v of value.values.getElements()) {
        if (!(v instanceof NumberValue)) return undefined;
        let n = v.value;
        if (Number.isNaN(n)) return undefined;
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
    if (range.lo < -MAX_SAFE_LENGTH || range.hi > MAX_SAFE_LENGTH) return undefined;
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
      else if (v instanceof NumberValue && !Number.isNaN(v.value))
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

function hasAnyAssumedConditions(pc: mixed): boolean {
  let cur = pc;
  while (cur instanceof PathConditionsImplementation) {
    if (!cur.isEmpty()) return true;
    cur = cur._baseConditions;
  }
  return false;
}

// Meets interval with facts of the form `value op constant` found in the path conditions,
// and picks the branch of a conditional value whose condition is implied by the path.
function refineWithPathConditions(
  value: AbstractValue,
  interval: IntervalDomain,
  depth: number,
  pathMemo: Map<AbstractValue, IntervalDomain | null>
): IntervalDomain {
  let realm = value.$Realm;
  if (value.kind === "conditional") {
    let [c, x, y] = value.args;
    let branch = Path.implies(c) ? x : Path.impliesNot(c) ? y : undefined;
    if (branch !== undefined) {
      let branchInterval = deriveWithPath(branch, depth + 1, pathMemo);
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

const flippedOperator: { [string]: string } = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "===": "===", "==": "==" };
const negatedOperator: { [string]: string } = {
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
  "!==": "===",
  "!=": "==",
};

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
  if (op === undefined || Number.isNaN(k)) return undefined;
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
      return new IntervalDomain(-Infinity, integral ? Math.ceil(k) - 1 : k, false, mayBeNaN, k > 0);
    case "<=":
      return new IntervalDomain(-Infinity, integral ? Math.floor(k) : k, false, mayBeNaN, true);
    case ">":
      return new IntervalDomain(integral ? Math.floor(k) + 1 : k, Infinity, false, mayBeNaN, k < 0);
    case ">=":
      return new IntervalDomain(integral ? Math.ceil(k) : k, Infinity, false, mayBeNaN, true);
    default:
      return undefined;
  }
}

const baseCache: WeakMap<AbstractValue, IntervalDomain | null> = new WeakMap();
const derivations: WeakMap<
  AbstractValue,
  { args: Array<Value>, operationDescriptor: OperationDescriptor }
> = new WeakMap();

function deriveBase(value: Value, depth: number): void | IntervalDomain {
  if (value instanceof NumberValue) return IntervalDomain.point(value.value);
  if (!(value instanceof AbstractValue) || value.mightNotBeNumber()) return undefined;
  let cached = baseCache.get(value);
  if (cached !== undefined) return cached === null ? undefined : cached;
  let result = depth > MAX_DEPTH ? IntervalDomain.top : deriveAbstract(value, depth, undefined);
  if (depth <= MAX_DEPTH) baseCache.set(value, result);
  return result;
}

function deriveWithPath(
  value: Value,
  depth: number,
  pathMemo: Map<AbstractValue, IntervalDomain | null>
): void | IntervalDomain {
  if (value instanceof NumberValue) return IntervalDomain.point(value.value);
  if (!(value instanceof AbstractValue) || value.mightNotBeNumber()) return undefined;
  let memoized = pathMemo.get(value);
  if (memoized !== undefined) return memoized === null ? undefined : memoized;
  let base = deriveBase(value, depth);
  if (base === undefined) {
    pathMemo.set(value, null);
    return undefined;
  }
  if (depth > MAX_DEPTH) return base;
  // Guard against cycles before recursing.
  pathMemo.set(value, base);
  let result = base.meet(deriveAbstract(value, depth, pathMemo));
  result = refineWithPathConditions(value, result, depth, pathMemo);
  pathMemo.set(value, result);
  return result;
}

function deriveChild(
  value: Value,
  depth: number,
  pathMemo: void | Map<AbstractValue, IntervalDomain | null>
): void | IntervalDomain {
  return pathMemo === undefined ? deriveBase(value, depth) : deriveWithPath(value, depth, pathMemo);
}

function deriveToNumber(
  value: Value,
  depth: number,
  pathMemo: void | Map<AbstractValue, IntervalDomain | null>
): IntervalDomain {
  if (value instanceof BooleanValue) return IntervalDomain.point(value.value ? 1 : 0);
  if (value instanceof NullValue) return IntervalDomain.point(0);
  if (value instanceof UndefinedValue) return IntervalDomain.point(NaN);
  if (value instanceof AbstractValue && value.getType() === BooleanValue) return IntervalDomain.integers(0, 1);
  return deriveChild(value, depth, pathMemo) || IntervalDomain.top;
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

function deriveAbstract(
  value: AbstractValue,
  depth: number,
  pathMemo: void | Map<AbstractValue, IntervalDomain | null>
): IntervalDomain {
  let fromValues = fromValuesDomain(value);
  if (fromValues !== undefined && value.kind !== "conditional") return fromValues;
  let args = value.args;
  let kind = value.kind;
  // Temporal expressions (whose operands might have side-effecting conversions) are derived
  // values; if they return normally, their numeric result matches the underlying operation.
  let derivation = derivations.get(value);
  if (derivation !== undefined) {
    args = derivation.args;
    let desc = derivation.operationDescriptor;
    if (desc.type === "BINARY_EXPRESSION") kind = desc.data.binaryOperator;
    else if (desc.type === "UNARY_EXPRESSION") kind = desc.data.unaryOperator;
    else if (desc.type === "ABSTRACT_FROM_TEMPLATE" && typeof desc.data.templateSource === "string")
      kind = `template:${desc.data.templateSource}`;
  }
  let d = depth + 1;
  switch (kind) {
    case "conditional": {
      let a = deriveChild(args[1], d, pathMemo);
      let b = deriveChild(args[2], d, pathMemo);
      if (a === undefined || b === undefined) return fromValues || IntervalDomain.top;
      let joined = a.join(b);
      return fromValues !== undefined ? joined.meet(fromValues) : joined;
    }
    case "+":
    case "-":
    case "*": {
      if (args.length !== 2) {
        // Unary minus and plus use the operator as kind as well.
        let operand = deriveToNumber(args[0], d, pathMemo);
        return kind === "-" ? negate(operand) : kind === "+" ? operand : IntervalDomain.top;
      }
      let [x, y] = args;
      if (!isPrimitiveNonString(x) || !isPrimitiveNonString(y)) return IntervalDomain.top;
      return arithmetic(kind, deriveToNumber(x, d, pathMemo), deriveToNumber(y, d, pathMemo));
    }
    case "%":
      return remainder(deriveToNumber(args[0], d, pathMemo), deriveToNumber(args[1], d, pathMemo));
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
    case ">>>":
      return bitwise(
        kind,
        deriveToNumber(args[0], d, pathMemo).toInt32(),
        deriveToNumber(args[1], d, pathMemo).toInt32()
      );
    case "~":
      return IntervalDomain.int32;
    case "(A).length":
    case "template:(A).length":
      return args.length >= 1 ? stringLengthInterval(args[0], d) : IntervalDomain.arrayLength;
    default:
      if (typeof kind === "string" && kind.startsWith("template:global.Math.")) {
        let match = /^template:global\.Math\.(\w+)\(/.exec(kind);
        if (match) return mathFunction(match[1], args.map(a => deriveToNumber(a, d, pathMemo)));
      }
      return fromValues || IntervalDomain.top;
  }
}

function stringLengthInterval(str: Value, depth: number): IntervalDomain {
  if (depth > MAX_DEPTH) return IntervalDomain.arrayLength;
  if (str instanceof StringValue) return IntervalDomain.point(str.value.length);
  if (!(str instanceof AbstractValue) || str.getType() !== StringValue) return IntervalDomain.arrayLength;
  if (!str.values.isTop()) {
    let result;
    for (let elem of str.values.getElements()) {
      if (!(elem instanceof StringValue)) return IntervalDomain.arrayLength;
      let p = IntervalDomain.point(elem.value.length);
      result = result === undefined ? p : result.join(p);
    }
    if (result !== undefined) return result;
  }
  if (str.kind === "conditional") {
    return stringLengthInterval(str.args[1], depth + 1).join(stringLengthInterval(str.args[2], depth + 1));
  }
  if (
    str.kind === "+" &&
    str.args.length === 2 &&
    str.args[0].getType() === StringValue &&
    str.args[1].getType() === StringValue
  ) {
    let a = stringLengthInterval(str.args[0], depth + 1);
    let b = stringLengthInterval(str.args[1], depth + 1);
    return IntervalDomain.integers(Math.min(MAX_SAFE_LENGTH, a.lo + b.lo), Math.min(MAX_SAFE_LENGTH, a.hi + b.hi));
  }
  return IntervalDomain.arrayLength;
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
  if (op === "+") {
    // (+Infinity) + (-Infinity) is NaN even when neither endpoint sum (lo+lo, hi+hi) is NaN.
    if ((a.lo === -Infinity && b.hi === Infinity) || (a.hi === Infinity && b.lo === -Infinity))
      return IntervalDomain.top;
  } else {
    // 0 * +/-Infinity is NaN even when 0 is strictly inside one interval.
    let aHasZero = a.lo <= 0 && a.hi >= 0;
    let bHasZero = b.lo <= 0 && b.hi >= 0;
    let aHasInf = !isFinite(a.lo) || !isFinite(a.hi);
    let bHasInf = !isFinite(b.lo) || !isFinite(b.hi);
    if ((aHasZero && bHasInf) || (bHasZero && aHasInf)) return IntervalDomain.top;
  }
  let candidates = op === "+" ? [a.lo + b.lo, a.hi + b.hi] : [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  if (candidates.some(c => Number.isNaN(c))) return IntervalDomain.top;
  let mayBeNaN = a.mayBeNaN || b.mayBeNaN;
  let lo = Math.min(...candidates);
  let hi = Math.max(...candidates);
  let integral = a.integral && b.integral && isFinite(lo) && isFinite(hi);
  // Sums of integers beyond 2^53 are still integers, though rounded; bounds stay sound because
  // IEEE-754 rounding is monotone. -0 arises from -0 + -0, or from multiplying zero by a negative number.
  let mayBeNegZero = op === "+" ? a.mayBeNegZero && b.mayBeNegZero : lo <= 0 && hi >= 0;
  return new IntervalDomain(lo, hi, integral, mayBeNaN, mayBeNegZero);
}

function remainder(a: IntervalDomain, b: IntervalDomain): IntervalDomain {
  if (a.isOnlyNaN() || b.isOnlyNaN()) return IntervalDomain.point(NaN);
  if (b.lo === 0 && b.hi === 0) return IntervalDomain.point(NaN);
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
    case "<<":
      if (b.lo === b.hi) {
        let s = b.lo & 31;
        let factor = Math.pow(2, s);
        if (a.lo * factor >= INT32_MIN && a.hi * factor <= INT32_MAX)
          return IntervalDomain.integers(a.lo << s, a.hi << s);
      }
      return IntervalDomain.int32;
    case ">>":
      if (b.lo === b.hi) {
        let s = b.lo & 31;
        return IntervalDomain.integers(a.lo >> s, a.hi >> s);
      }
      return IntervalDomain.int32;
    case ">>>":
      if (b.lo === b.hi) {
        let s = b.lo & 31;
        if (a.lo >= 0) return IntervalDomain.integers(a.lo >>> s, a.hi >>> s);
        if (s > 0) return IntervalDomain.integers(0, UINT32_MAX >>> s);
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
        args.some(a => a.mayBeNegZero)
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
