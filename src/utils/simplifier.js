/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { BabelNodeSourceLocation } from "@babel/types";
import { FatalError, InfeasiblePathError } from "../errors.js";
import { IntervalDomain, ValuesDomain } from "../domains/index.js";
import invariant from "../invariant.js";
import { Realm } from "../realm.js";
import { AbstractValue, BooleanValue, ConcreteValue, IntegralValue, StringValue, Value } from "../values/index.js";
import { Path, To } from "../singletons.js";
import EmptyValue from "../values/EmptyValue.js";
import { createOperationDescriptor } from "./generator.js";
import {
  FunctionValue,
  NullValue,
  NumberValue,
  ObjectValue,
  PrimitiveValue,
  ProxyValue,
  SymbolValue,
  UndefinedValue,
} from "../values/index.js";
import { IsCallable } from "../methods/index.js";
import { auditRewrite, smtAuditing } from "./smt/index.js";

function knownTypeofString(realm: Realm, val: Value): void | string {
  let type = val.getType();
  if (type === UndefinedValue) return "undefined";
  if (type === NullValue) return "object";
  if (type === StringValue) return "string";
  if (type === BooleanValue) return "boolean";
  if (Value.isTypeCompatibleWith(type, NumberValue)) return "number";
  if (type === SymbolValue) return "symbol";
  if (Value.isTypeCompatibleWith(type, FunctionValue)) return "function";
  if (val instanceof ObjectValue && !(val instanceof ProxyValue)) {
    return IsCallable(realm, val) ? "function" : "object";
  }
  let refined = To.GetToPrimitivePureResultType(realm, val);
  if (refined === StringValue) return "string";
  if (refined === NumberValue) return "number";
  if (refined === BooleanValue) return "boolean";
  if (refined === UndefinedValue) return "undefined";
  if (refined === SymbolValue) return "symbol";
  return undefined;
}

export default function simplifyAndRefineAbstractValue(
  realm: Realm,
  isCondition: boolean, // The value is only used after converting it to a Boolean
  value: AbstractValue
): Value {
  if (value.intrinsicName !== undefined) return value;
  let savedHandler = realm.errorHandler;
  let savedIsReadOnly = realm.isReadOnly;
  realm.isReadOnly = true;
  let isRootSimplification = false;
  realm.statistics.simplificationAttempts++;

  if (!realm.inSimplificationPath) {
    realm.inSimplificationPath = isRootSimplification = true;
  }
  try {
    realm.errorHandler = diagnostic => {
      if (diagnostic.errorCode === "PP0029") {
        throw new FatalError(`${diagnostic.errorCode}: ${diagnostic.message}`);
      }
      throw new FatalError();
    };
    let result = simplify(realm, value, isCondition, 0);
    if (result !== value) {
      realm.statistics.simplifications++;
      if (smtAuditing(realm)) {
        auditRewrite(realm, realm.pathConditions.getAllConditions(), value, result, isCondition);
      }
    }
    return result;
  } catch (e) {
    if (e.name === "Invariant Violation" || e.name === "SmtAuditError") throw e;
    if (e instanceof FatalError && typeof e.message === "string" && e.message.includes("PP0029")) {
      if (isRootSimplification) {
        return value;
      }
      throw e;
    }
    return value;
  } finally {
    if (isRootSimplification) {
      realm.abstractValueImpliesCounter = 0;
      realm.inSimplificationPath = false;
      negatedConjunctions.length = 0;
      activeNegatedValues.length = 0;
    }
    realm.errorHandler = savedHandler;
    realm.isReadOnly = savedIsReadOnly;
  }
}

function containsTemporal(v: Value): boolean {
  if (v.isTemporal()) return true;
  if (v instanceof AbstractValue) {
    for (let sub of v.args) {
      if (containsTemporal(sub)) return true;
    }
  }
  return false;
}

function simplify(realm, value: Value, isCondition: boolean = false, depth: number): Value {
  if (value instanceof ConcreteValue || depth > 5) return value;
  invariant(value instanceof AbstractValue);
  if (value.mightHaveBeenDeleted() && AbstractValue._preservingEmpty) {
    return simplifyWithEmpty(realm, value, isCondition, depth);
  }
  if (isCondition || value.getType() === BooleanValue) {
    if (Path.implies(value, depth + 1)) return realm.intrinsics.true;
    if (Path.impliesNot(value, depth + 1)) return realm.intrinsics.false;
  }
  if (value.intrinsicName !== undefined) return value;
  let loc = value.expressionLocation;
  let op = value.kind;
  switch (op) {
    case "!": {
      let [x0] = value.args;
      invariant(x0 instanceof AbstractValue);
      if (x0.kind === "!") {
        invariant(x0 instanceof AbstractValue);
        let [x00] = x0.args;
        let xx = simplify(realm, x00, true, depth + 1);
        if (isCondition || xx.getType() === BooleanValue) return xx;
      }
      return negate(realm, x0, depth + 1, loc, value, isCondition);
    }
    case "||":
    case "&&": {
      let [x0, y0] = value.args;
      let x = simplify(realm, x0, isCondition, depth + 1);
      let y = simplify(realm, y0, isCondition, depth + 1);
      if (x instanceof AbstractValue && x.equals(y)) return x;
      // true && y <=> y
      // true || y <=> true
      if (!x.mightNotBeTrue()) return op === "&&" ? y : x;
      // (x == false) && y <=> x
      // false || y <=> y
      if (!x.mightNotBeFalse()) return op === "||" ? y : x;
      if (isCondition || (x.getType() === BooleanValue && y.getType() === BooleanValue)) {
        // (x: boolean) && true <=> x
        // x || true <=> true
        if (!y.mightNotBeTrue()) return op === "&&" ? x : realm.intrinsics.true;
        // (x: boolean) && false <=> false
        // (x: boolean) || false <=> x
        if (!y.mightNotBeFalse()) return op === "||" ? x : realm.intrinsics.false;
      }
      if (op === "||") {
        // (c && y) || y <=> y when y is guaranteed truthy (!y.mightBeFalse())
        if (x instanceof AbstractValue && x.kind === "&&" && !y.mightBeFalse() && x.args[1].equals(y)) {
          return y;
        }
        if (y instanceof AbstractValue && y.kind === "||") {
          // x || x || y <=> x || y
          if (x.equals(y.args[0])) return y;
          if (x instanceof AbstractValue && x.kind === "!") {
            // !x0 || y0 || x0 <=> true, if isCondition
            if (isCondition && x.args[0].equals(y.args[1])) return realm.intrinsics.true;
          }
        }
      }
      if (op === "&&") {
        if (x instanceof AbstractValue) {
          if (x.kind === "&&") {
            // (x && y) && x <=> x && y, if isCondition
            if (isCondition && x.args[0].equals(y)) return x;
            // (x && y) && y <=> x && y
            if (x.args[1].equals(y)) return x;
          } else if (x.kind === "!") {
            // !x && x <=> false, if isCondition
            if (isCondition && x.args[0].equals(y)) return realm.intrinsics.false;
          }
        }
        if (y instanceof AbstractValue && y.kind === "&&") {
          // x && (x && y) <=> x && y
          if (x.equals(y.args[0])) return y;
          // y && (x && y) <=> x && y, if isCondition or both are boolean
          if (
            x.equals(y.args[1]) &&
            (isCondition || (x.getType() === BooleanValue && y.args[0].getType() === BooleanValue))
          ) {
            return y;
          }
        }
        // x && (x && y || x && z) <=> x && (y || z)
        if (y instanceof AbstractValue && y.kind === "||") {
          let [yx, yy] = y.args;
          let yxs, yys;
          if (yx instanceof AbstractValue && yx.kind === "&&") {
            if (x.equals(yx.args[0])) yxs = yx.args[1];
            else if (
              x.equals(yx.args[1]) &&
              (isCondition || (x.getType() === BooleanValue && yx.args[0].getType() === BooleanValue))
            )
              yxs = yx.args[0];
          }
          if (yy instanceof AbstractValue && yy.kind === "&&") {
            if (x.equals(yy.args[0])) yys = yy.args[1];
            else if (
              x.equals(yy.args[1]) &&
              (isCondition || (x.getType() === BooleanValue && yy.args[0].getType() === BooleanValue))
            )
              yys = yy.args[0];
          }
          if (yxs !== undefined || yys !== undefined) {
            let ys = AbstractValue.createFromLogicalOp(realm, "||", yxs || yx, yys || yy, undefined, isCondition);
            return AbstractValue.createFromLogicalOp(realm, "&&", x, ys, undefined, isCondition);
          }
        }
      }
      if (realm.instantRender.enabled) {
        if (op === "||" && x0 instanceof AbstractValue && y0 instanceof AbstractValue) {
          if (x0.kind === "===" && y0.kind === "===") {
            let [xa, xb] = x0.args;
            let [ya, yb] = y0.args;
            if (xa.equals(ya) && !xb.equals(yb) && nullOrUndefined(xb) && nullOrUndefined(yb)) return rewrite(xa);
            else if (xb.equals(yb) && !xa.equals(ya) && nullOrUndefined(xa) && nullOrUndefined(ya)) return rewrite(xb);
            else if (xa.equals(yb) && !xb.equals(ya) && nullOrUndefined(xb) && nullOrUndefined(ya)) return rewrite(xa);
            else if (xb.equals(ya) && !xa.equals(yb) && nullOrUndefined(xa) && nullOrUndefined(yb)) return rewrite(xb);
            function nullOrUndefined(z: Value) {
              return !z.mightNotBeNull() || !z.mightNotBeUndefined();
            }
            function rewrite(z: Value) {
              return AbstractValue.createFromBuildFunction(
                realm,
                BooleanValue,
                [z],
                createOperationDescriptor("CANNOT_BECOME_OBJECT"),
                { kind: "global.__cannotBecomeObject(A)" }
              );
            }
          }
        }
      }
      if (x.equals(x0) && y.equals(y0)) return value;
      return AbstractValue.createFromLogicalOp(realm, (value.kind: any), x, y, loc, isCondition, true);
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      let byIntervals = decideByIntervals(realm, op, value.args);
      if (byIntervals !== undefined) return byIntervals;
      let folded = foldConditionalArithmetic(realm, value, op);
      if (folded !== value) return simplify(realm, folded, isCondition, depth + 1);
      return distributeConditional(realm, value, isCondition, args =>
        AbstractValue.createFromBinaryOp(realm, op, args[0], args[1], loc, undefined, isCondition, true)
      );
    }
    case "+": {
      if (value.args.length !== 2) return value;
      let [x0, y0] = value.args;
      let x = simplify(realm, x0, false, depth + 1);
      let y = simplify(realm, y0, false, depth + 1);
      if (
        x instanceof ConcreteValue &&
        y instanceof ConcreteValue &&
        !(x instanceof EmptyValue) &&
        !(y instanceof EmptyValue)
      ) {
        return ValuesDomain.computeBinary(realm, "+", x, y);
      }
      if (x instanceof StringValue && x.value === "" && y.getType() === StringValue) return y;
      if (y instanceof StringValue && y.value === "" && x.getType() === StringValue) return x;
      if (y instanceof StringValue && x instanceof AbstractValue && x.kind === "+" && x.args.length === 2) {
        let [xl, xr] = x.args;
        if (xr instanceof StringValue) {
          return AbstractValue.createFromBinaryOp(
            realm,
            "+",
            xl,
            new StringValue(realm, xr.value + y.value),
            loc,
            undefined,
            isCondition
          );
        }
      }
      if (x instanceof StringValue && y instanceof AbstractValue && y.kind === "+" && y.args.length === 2) {
        let [yl, yr] = y.args;
        if (yl instanceof StringValue) {
          return AbstractValue.createFromBinaryOp(
            realm,
            "+",
            new StringValue(realm, x.value + yl.value),
            yr,
            loc,
            undefined,
            isCondition
          );
        }
      }
      let rebuilt =
        x.equals(x0) && y.equals(y0)
          ? value
          : AbstractValue.createFromBinaryOp(realm, "+", x, y, loc, undefined, isCondition, true);
      return rebuilt instanceof AbstractValue ? foldConditionalArithmetic(realm, rebuilt, "+") : rebuilt;
    }
    case "-":
    case "*":
    case "/":
    case "%":
    case "&":
    case "|":
    case "^":
    case "<<":
    case ">>":
    case ">>>":
      return foldConditionalArithmetic(realm, value, op);
    case "==":
    case "!=":
    case "===":
    case "!==": {
      let byIntervals = decideByIntervals(realm, op, value.args);
      if (byIntervals !== undefined) return byIntervals;
      let folded = foldConditionalArithmetic(realm, value, op);
      if (folded !== value) return simplify(realm, folded, isCondition, depth + 1);
      return simplifyEquality(realm, value, depth + 1);
    }
    case "typeof": {
      if (value.args.length !== 1) return value;
      let x0 = value.args[0];
      let x = simplify(realm, x0, false, depth + 1);
      let known = knownTypeofString(realm, x);
      if (known !== undefined) return new StringValue(realm, known);
      if (x instanceof AbstractValue && x.kind === "conditional") {
        let [cond, cons, alt] = x.args;
        let tCons = knownTypeofString(realm, cons);
        let tAlt = knownTypeofString(realm, alt);
        if (tCons !== undefined || tAlt !== undefined) {
          let consTypeVal =
            tCons !== undefined
              ? new StringValue(realm, tCons)
              : AbstractValue.createFromUnaryOp(realm, "typeof", (cons: any), true, loc);
          let altTypeVal =
            tAlt !== undefined
              ? new StringValue(realm, tAlt)
              : AbstractValue.createFromUnaryOp(realm, "typeof", (alt: any), true, loc);
          return AbstractValue.createFromConditionalOp(realm, cond, consTypeVal, altTypeVal, loc, isCondition);
        }
      }
      return x.equals(x0)
        ? value
        : AbstractValue.createFromUnaryOp(realm, "typeof", (x: any), true, loc, isCondition, true);
    }
    case "conditional": {
      let [c0, x0, y0] = value.args;
      let c = simplify(realm, c0, true, depth + 1);
      let x, y;
      if (c0 instanceof AbstractValue && c.mightBeFalse() && c.mightBeTrue()) {
        try {
          x = withAssumed(c0, () => simplify(realm, x0, isCondition, depth + 1));
        } catch (e) {
          if (e instanceof InfeasiblePathError) {
            // We now know that c0 cannot be be true on this path
            return simplify(realm, y0, isCondition, depth + 1);
          }
          throw e;
        }
        try {
          y = withNegated(realm, c0, () => simplify(realm, y0, isCondition, depth + 1));
        } catch (e) {
          if (e instanceof InfeasiblePathError) {
            // We now know that c0 cannot be be false on this path
            return x;
          }
          throw e;
        }
      }
      let cIsFalse = !c.mightNotBeFalse();
      let cIsTrue = !c.mightNotBeTrue();
      if (x === undefined && !cIsFalse) x = simplify(realm, x0, isCondition, depth + 1);
      if (cIsTrue) {
        invariant(x !== undefined); // cIsTrue ==> !cIsFalse
        return x;
      }
      if (y === undefined) y = simplify(realm, y0, isCondition, depth + 1);
      if (cIsFalse) return y;
      invariant(x !== undefined); // because !csIsFalse
      invariant(c instanceof AbstractValue);
      if (Path.implies(c, depth + 1)) return x;
      let notc = AbstractValue.createFromUnaryOp(realm, "!", c, true, loc, isCondition, true);
      if (!notc.mightNotBeTrue()) return y;
      if (!notc.mightNotBeFalse()) return x;
      invariant(notc instanceof AbstractValue);
      if (Path.implies(notc, depth + 1)) return y;
      if (!isCondition) {
        if (
          !containsTemporal(x) &&
          cannotDifferOnlyByZeroSign(value, x) &&
          Path.implies(AbstractValue.createFromBinaryOp(realm, "===", value, x), depth + 1)
        )
          return x;
        if (!x.mightBeNumber() && Path.implies(AbstractValue.createFromBinaryOp(realm, "!==", value, x), depth + 1))
          return y;
        if (!y.mightBeNumber() && Path.implies(AbstractValue.createFromBinaryOp(realm, "!==", value, y), depth + 1))
          return x;
        if (
          !containsTemporal(y) &&
          cannotDifferOnlyByZeroSign(value, y) &&
          Path.implies(AbstractValue.createFromBinaryOp(realm, "===", value, y), depth + 1)
        )
          return y;
      }
      // c ? x : x <=> x
      if (x.equals(y)) return x;
      // If under c, y already simplifies to x, then (c ? x : y) <=> y; symmetrically for x under !c.
      if (depth <= 3) {
        if (y instanceof AbstractValue && !containsTemporal(y)) {
          let yVal = y;
          try {
            let yWhenC = Path.withCondition(c, () => simplify(realm, yVal, isCondition, depth + 1));
            if (yWhenC.equals(x)) return yVal;
          } catch (e) {
            if (e instanceof InfeasiblePathError) return yVal;
            throw e;
          }
        }
        if (x instanceof AbstractValue && !containsTemporal(x)) {
          let xVal = x;
          try {
            let xWhenNotC = Path.withInverseCondition(c, () => simplify(realm, xVal, isCondition, depth + 1));
            if (xWhenNotC.equals(y)) return xVal;
          } catch (e) {
            if (e instanceof InfeasiblePathError) return xVal;
            throw e;
          }
        }
      }
      // x ? x : y <=> x || y
      let cs = isCondition ? c : simplify(realm, c0, false, depth + 1);
      if (cs.equals(x)) return AbstractValue.createFromLogicalOp(realm, "||", x, y, loc, isCondition, true);
      // y ? x : y <=> y && x
      if (cs.equals(y)) return AbstractValue.createFromLogicalOp(realm, "&&", y, x, loc, isCondition, true);
      // c ? (c ? xx : xy) : y <=> c ? xx : y
      if (x instanceof AbstractValue && x.kind === "conditional") {
        let [xc, xx] = x.args;
        if (c.equals(xc))
          return AbstractValue.createFromConditionalOp(realm, c, xx, y, value.expressionLocation, isCondition, true);
      }
      // c ? x : (c ? y : z) : z <=> c ? x : z
      if (y instanceof AbstractValue && y.kind === "conditional") {
        let [yc, , z] = y.args;
        if (c.equals(yc))
          return AbstractValue.createFromConditionalOp(realm, c, x, z, value.expressionLocation, isCondition, true);
      }
      if (isCondition || (x.getType() === BooleanValue && y.getType() === BooleanValue)) {
        // c ? true : false <=> c, if c is boolean (or only used as a condition); otherwise it is !!c
        if (!x.mightNotBeTrue() && !y.mightNotBeFalse())
          return isCondition || c.getType() === BooleanValue ? c : makeBoolean(realm, c, loc);
        // c ? false : true <=> !c
        if (!x.mightNotBeFalse() && !y.mightNotBeTrue())
          return AbstractValue.createFromUnaryOp(realm, "!", c, true, loc, isCondition);
        if (x.getType() === BooleanValue && y.getType() === BooleanValue) {
          if (isCondition || c.getType() === BooleanValue) {
            // c ? x : false <=> c && x
            if (!y.mightNotBeFalse()) return AbstractValue.createFromLogicalOp(realm, "&&", c, x, loc, isCondition);
            // c ? true : y <=> c || y
            if (!x.mightNotBeTrue()) return AbstractValue.createFromLogicalOp(realm, "||", c, y, loc, isCondition);
          }
          // c ? false : y <=> !c && y
          if (!x.mightNotBeFalse()) {
            let negC = AbstractValue.createFromUnaryOp(realm, "!", c, true, loc, isCondition);
            return AbstractValue.createFromLogicalOp(realm, "&&", negC, y, loc, isCondition);
          }
          // c ? x : true <=> !c || x
          if (!y.mightNotBeTrue()) {
            let negC = AbstractValue.createFromUnaryOp(realm, "!", c, true, loc, isCondition);
            return AbstractValue.createFromLogicalOp(realm, "||", negC, x, loc, isCondition);
          }
        }
      }
      if (c.equals(c0) && x.equals(x0) && y.equals(y0)) return value;
      return AbstractValue.createFromConditionalOp(realm, c, x, y, value.expressionLocation, isCondition, true);
    }
    case "abstractConcreteUnion": {
      // The union of an abstract value with one or more concrete values.
      if (realm.pathConditions.isEmpty()) return value;
      let [abstractValue, concreteValues] = AbstractValue.dischargeValuesFromUnion(realm, value);
      invariant(abstractValue instanceof AbstractValue);
      let remainingConcreteValues = [];
      for (let concreteValue of concreteValues) {
        if (Path.implies(AbstractValue.createFromBinaryOp(realm, "!==", value, concreteValue), depth + 1)) continue;
        if (Path.implies(AbstractValue.createFromBinaryOp(realm, "===", value, concreteValue), depth + 1))
          return concreteValue;
        remainingConcreteValues.push(concreteValue);
      }
      if (remainingConcreteValues.length === 0) return abstractValue;
      if (remainingConcreteValues.length === concreteValues.length) return value;
      return AbstractValue.createAbstractConcreteUnion(realm, abstractValue, remainingConcreteValues);
    }
    default:
      return value;
  }
}

// Pairs [p, q] for which !(p && q) holds on the active simplification path.
const negatedConjunctions: Array<[Value, Value]> = [];
const activeNegatedValues: Array<AbstractValue> = [];

function withAssumed<T>(condition: AbstractValue, fn: () => T): T {
  return Path.withCondition(condition, () => propagateUnits(condition.$Realm, fn, 0));
}

function withNegated<T>(realm: Realm, condition: AbstractValue, fn: () => T): T {
  let savedLen = negatedConjunctions.length;
  let savedNegLen = activeNegatedValues.length;
  activeNegatedValues.push(condition);
  if (condition.kind === "&&" && negatedConjunctions.length < 16) {
    negatedConjunctions.push([condition.args[0], condition.args[1]]);
  } else if (condition.kind === "conditional" && negatedConjunctions.length < 15) {
    let [cc, ca, cb] = condition.args;
    negatedConjunctions.push([cc, ca]);
    if (cc instanceof AbstractValue) {
      let notCc = AbstractValue.createFromUnaryOp(realm, "!", cc, true, undefined, true, true);
      negatedConjunctions.push([notCc, cb]);
    }
  }
  try {
    return Path.withInverseCondition(condition, () => propagateUnits(realm, fn, 0));
  } finally {
    negatedConjunctions.length = savedLen;
    activeNegatedValues.length = savedNegLen;
  }
}

function isAlreadyNegated(v: AbstractValue): boolean {
  for (let i = 0; i < activeNegatedValues.length; i++) {
    if (activeNegatedValues[i] === v || activeNegatedValues[i].equals(v)) return true;
  }
  return false;
}

function propagateUnits<T>(realm: Realm, fn: () => T, depth: number): T {
  if (depth < 4) {
    for (let i = 0; i < negatedConjunctions.length; i++) {
      let [p, q] = negatedConjunctions[i];
      let pTrue = Path.implies(p);
      let qTrue = Path.implies(q);
      if (pTrue && qTrue) throw new InfeasiblePathError();
      if (pTrue && q instanceof AbstractValue && q.mightBeTrue() && !isAlreadyNegated(q) && !Path.impliesNot(q)) {
        return withNegated(realm, q, () => propagateUnits(realm, fn, depth + 1));
      }
      if (qTrue && p instanceof AbstractValue && p.mightBeTrue() && !isAlreadyNegated(p) && !Path.impliesNot(p)) {
        return withNegated(realm, p, () => propagateUnits(realm, fn, depth + 1));
      }
    }
  }
  return fn();
}

// Safe simplification for values that may contain EmptyValue (__empty). General rules such as
// equality or logical-operator rewrites must not run on EmptyValue because EmptyValue extends
// UndefinedValue internally while serializing to an object sentinel ({}) at runtime.
function simplifyWithEmpty(realm: Realm, value: AbstractValue, isCondition: boolean, depth: number): Value {
  if (value.kind !== "conditional") return value;
  let [c0, x0, y0] = value.args;
  let c = simplify(realm, c0, true, depth + 1);
  if (!c.mightNotBeTrue()) return simplify(realm, x0, isCondition, depth + 1);
  if (!c.mightNotBeFalse()) return simplify(realm, y0, isCondition, depth + 1);
  invariant(c instanceof AbstractValue);
  if (Path.implies(c, depth + 1)) return simplify(realm, x0, isCondition, depth + 1);
  if (Path.impliesNot(c, depth + 1)) return simplify(realm, y0, isCondition, depth + 1);

  let x, y;
  if (c0 instanceof AbstractValue) {
    try {
      x = withAssumed(c0, () => simplify(realm, x0, isCondition, depth + 1));
    } catch (e) {
      if (e instanceof InfeasiblePathError) return simplify(realm, y0, isCondition, depth + 1);
      throw e;
    }
    try {
      y = withNegated(realm, c0, () => simplify(realm, y0, isCondition, depth + 1));
    } catch (e) {
      if (e instanceof InfeasiblePathError) return x;
      throw e;
    }
  } else {
    x = simplify(realm, x0, isCondition, depth + 1);
    y = simplify(realm, y0, isCondition, depth + 1);
  }
  if (x.equals(y)) return x;
  let loc = value.expressionLocation;
  // If pruning eliminated every EmptyValue, run full simplification on the remaining conditional.
  if (!x.mightHaveBeenDeleted() && !y.mightHaveBeenDeleted()) {
    return AbstractValue.createFromConditionalOp(realm, c, x, y, loc, isCondition);
  }
  // c1 ? (c2 ? v : empty) : empty <=> (c1 && c2) ? v : empty
  if (
    y instanceof EmptyValue &&
    x instanceof AbstractValue &&
    x.kind === "conditional" &&
    x.args[2] instanceof EmptyValue
  ) {
    let both = AbstractValue.createFromLogicalOp(realm, "&&", c, x.args[0], loc, true);
    return AbstractValue.createFromConditionalOp(realm, both, x.args[1], y, loc, isCondition, true);
  }
  // c1 ? empty : (c2 ? empty : v) <=> (c1 || c2) ? empty : v
  if (
    x instanceof EmptyValue &&
    y instanceof AbstractValue &&
    y.kind === "conditional" &&
    y.args[1] instanceof EmptyValue
  ) {
    let either = AbstractValue.createFromLogicalOp(realm, "||", c, y.args[0], loc, true);
    return AbstractValue.createFromConditionalOp(realm, either, x, y.args[2], loc, isCondition, true);
  }
  if (c.equals(c0) && x.equals(x0) && y.equals(y0)) return value;
  return AbstractValue.createFromConditionalOp(realm, c, x, y, loc, isCondition, true);
}

// Returns true when `a === b` guarantees `Object.is(a, b)` (i.e. {a, b} cannot be {-0, +0}).
function cannotDifferOnlyByZeroSign(a: Value, b: Value): boolean {
  if (!a.mightBeNumber() || !b.mightBeNumber()) return true;
  let ia = IntervalDomain.of(a);
  let ib = IntervalDomain.of(b);
  return ia !== undefined && ib !== undefined && !ia.mayBeNegZero && !ib.mayBeNegZero;
}

function decideByIntervals(realm: Realm, op: any, args: Array<Value>): void | BooleanValue {
  if (args.length !== 2) return undefined;
  let [x, y] = args;
  if (x.mightNotBeNumber() || y.mightNotBeNumber()) return undefined;
  let a = IntervalDomain.of(x);
  let b = IntervalDomain.of(y);
  if (a === undefined || b === undefined) return undefined;
  let decided = IntervalDomain.compare(op, a, b);
  if (decided === undefined) return undefined;
  return decided ? realm.intrinsics.true : realm.intrinsics.false;
}

// (c ? x : y) op z <=> c ? (x op z) : (y op z), if x, y and z are concrete primitives (or, recursively,
// conditionals whose leaves are), so that every leaf folds to a constant. This keeps numeric facts
// such as the length of an array after conditional pushes precise, and turns comparisons of such
// values into boolean formulas over the conditions.
function foldConditionalArithmetic(realm: Realm, value: AbstractValue, op: any): Value {
  if (value.args.length !== 2) return value;
  let [x, y] = value.args;
  // Do not distribute string concatenation over conditionals unless the string constant is short
  // (at most 2 chars, e.g. ":" or "") — distributing a long prefix like `"btn active disabled "`
  // duplicates the literal and prevents sharing `(c ? a : b)` across branches.
  if (op === "+" && (x.getType() === StringValue || y.getType() === StringValue)) {
    let constStr = x instanceof StringValue ? x.value : y instanceof StringValue ? y.value : undefined;
    if (constStr === undefined || constStr.length > 2) return value;
  }
  let isEquality = op === "===" || op === "!==" || op === "==" || op === "!=";
  // Only fold comparisons of numbers and strings. Folding comparisons of booleans would loop, since
  // simplifying the conditional result compares it with its own (boolean) branches.
  let isFoldableLeaf = v =>
    isEquality
      ? v instanceof NumberValue || v instanceof StringValue
      : v instanceof PrimitiveValue && !(v instanceof EmptyValue);
  let budget = { nodes: 32 };
  let memo = new Map();
  let result;
  if (x instanceof AbstractValue && x.kind === "conditional" && isFoldableLeaf(y)) {
    result = mapConditionalLeaves(realm, x, leaf => computeLeaf(realm, op, leaf, y), isFoldableLeaf, budget, memo);
  } else if (y instanceof AbstractValue && y.kind === "conditional" && isFoldableLeaf(x)) {
    result = mapConditionalLeaves(realm, y, leaf => computeLeaf(realm, op, x, leaf), isFoldableLeaf, budget, memo);
  }
  return result === undefined ? value : result;
}

function computeLeaf(realm: Realm, op: any, x: Value, y: Value): void | Value {
  invariant(x instanceof ConcreteValue && y instanceof ConcreteValue);
  let r = ValuesDomain.computeBinary(realm, op, x, y);
  return r instanceof PrimitiveValue ? r : undefined;
}

function mapConditionalLeaves(
  realm: Realm,
  value: Value,
  f: Value => void | Value,
  isFoldableLeaf: Value => boolean,
  budget: { nodes: number },
  memo: Map<AbstractValue, Value | null>
): void | Value {
  if (!(value instanceof AbstractValue)) {
    if (!isFoldableLeaf(value)) return undefined;
    return f(value);
  }
  let cached = memo.get(value);
  if (cached !== undefined) return cached === null ? undefined : cached;
  if (value.kind !== "conditional" || --budget.nodes < 0) {
    memo.set(value, null);
    return undefined;
  }
  let [c, l, r] = value.args;
  let lr = mapConditionalLeaves(realm, l, f, isFoldableLeaf, budget, memo);
  if (lr === undefined) {
    memo.set(value, null);
    return undefined;
  }
  let rr = mapConditionalLeaves(realm, r, f, isFoldableLeaf, budget, memo);
  if (rr === undefined) {
    memo.set(value, null);
    return undefined;
  }
  let res = AbstractValue.createFromConditionalOp(realm, c, lr, rr, value.expressionLocation);
  memo.set(value, res);
  return res;
}

function distributeConditional(
  realm: Realm,
  value: AbstractValue,
  isCondition: boolean,
  create: (Array<Value>) => Value
): Value {
  // Find a conditional argument
  let condition;
  let args = value.args;
  for (let arg of args)
    if (arg instanceof AbstractValue && arg.kind === "conditional") {
      if (condition === undefined) condition = arg.args[0];
      else if (condition !== arg.args[0]) return value; // giving up, multiple conditions involved
    }

  if (condition === undefined) return value; // no conditional found, nothing to do

  // We have at least one conditional argument; if there are more than one, they all share the same condition
  let leftArgs = args.slice(0);
  let rightArgs = args.slice(0);
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg instanceof AbstractValue && arg.kind === "conditional") {
      leftArgs[i] = arg.args[1];
      rightArgs[i] = arg.args[2];
    }
  }

  return AbstractValue.createFromConditionalOp(
    realm,
    condition,
    create(leftArgs),
    create(rightArgs),
    condition.expressionLocation,
    isCondition,
    true
  );
}

function simplifyNullCheck(
  realm: Realm,
  op: "===" | "==" | "!==" | "!=",
  value: Value,
  depth: number,
  loc: ?BabelNodeSourceLocation
): void | Value {
  if (op === "==" || op === "!=") {
    if (!value.mightNotBeNull() || !value.mightNotBeUndefined())
      return op === "==" ? realm.intrinsics.true : realm.intrinsics.false;
    if (!value.mightBeNull() && !value.mightBeUndefined())
      return op === "==" ? realm.intrinsics.false : realm.intrinsics.true;
  } else {
    if (!value.mightNotBeNull()) return op === "===" ? realm.intrinsics.true : realm.intrinsics.false;
    if (!value.mightBeNull()) return op === "===" ? realm.intrinsics.false : realm.intrinsics.true;
  }
  invariant(value instanceof AbstractValue); // concrete values will either be null or not null
  // try to simplify "(cond ? x : y) op null" to just "cond" or "!cond"
  // failing that, use "cond ? x op null : y op null" if either of the subexpressions simplify
  if (value.kind === "conditional" && depth < 10) {
    let [cond, x, y] = value.args;
    let sx = simplifyNullCheck(realm, op, x, depth + 1, loc);
    let sy = simplifyNullCheck(realm, op, y, depth + 1, loc);
    if (sx !== undefined && sy !== undefined) {
      if (!sx.mightNotBeTrue() && !sy.mightNotBeFalse()) return makeBoolean(realm, cond, loc);
      if (!sx.mightNotBeFalse() && !sy.mightNotBeTrue()) return negate(realm, cond, depth + 1, loc);
    }
    if (sx !== undefined || sy !== undefined) {
      if (sx === undefined)
        sx = AbstractValue.createFromBinaryOp(
          realm,
          op,
          x,
          realm.intrinsics.null,
          x.expressionLocation,
          undefined,
          false,
          true
        );
      if (sy === undefined)
        sy = AbstractValue.createFromBinaryOp(
          realm,
          op,
          y,
          realm.intrinsics.null,
          y.expressionLocation,
          undefined,
          false,
          true
        );
      return AbstractValue.createFromConditionalOp(realm, cond, sx, sy, loc, true, true);
    }
  }
}

function simplifyUndefinedCheck(
  realm: Realm,
  op: "===" | "==" | "!==" | "!=",
  value: Value,
  depth: number,
  loc: ?BabelNodeSourceLocation
): void | Value {
  if (op === "==" || op === "!=") {
    if (!value.mightNotBeNull() || !value.mightNotBeUndefined())
      return op === "==" ? realm.intrinsics.true : realm.intrinsics.false;
    if (!value.mightBeNull() && !value.mightBeUndefined())
      return op === "==" ? realm.intrinsics.false : realm.intrinsics.true;
  } else {
    if (!value.mightNotBeUndefined()) return op === "===" ? realm.intrinsics.true : realm.intrinsics.false;
    if (!value.mightBeUndefined()) return op === "===" ? realm.intrinsics.false : realm.intrinsics.true;
  }
  invariant(value instanceof AbstractValue); // concrete values will either be undefined or not undefined
  // try to simplify "(cond ? x : y) op undefined" to just "cond" or "!cond"
  // failing that, use "cond ? x op undefined : y op undefined" if either of the subexpressions simplify
  if (value.kind === "conditional" && depth < 10) {
    let [cond, x, y] = value.args;
    let sx = simplifyUndefinedCheck(realm, op, x, depth + 1, loc);
    let sy = simplifyUndefinedCheck(realm, op, y, depth + 1, loc);
    if (sx !== undefined && sy !== undefined) {
      if (!sx.mightNotBeTrue() && !sy.mightNotBeFalse()) return makeBoolean(realm, cond, loc);
      if (!sx.mightNotBeFalse() && !sy.mightNotBeTrue()) return negate(realm, cond, depth + 1, loc);
    }
    if (sx !== undefined || sy !== undefined) {
      if (sx === undefined)
        sx = AbstractValue.createFromBinaryOp(
          realm,
          op,
          x,
          realm.intrinsics.undefined,
          x.expressionLocation,
          undefined,
          false,
          true
        );
      if (sy === undefined)
        sy = AbstractValue.createFromBinaryOp(
          realm,
          op,
          y,
          realm.intrinsics.undefined,
          y.expressionLocation,
          undefined,
          false,
          true
        );
      return AbstractValue.createFromConditionalOp(realm, cond, sx, sy, loc, true, true);
    }
  }
}

function getKnownStringPrefix(v: Value, depth: number = 0): string {
  if (depth > 8) return "";
  if (v instanceof StringValue) return v.value;
  if (v instanceof AbstractValue && v.getType() === StringValue && v.kind === "+" && v.args.length === 2) {
    let [a, b] = v.args;
    if (a.getType() === StringValue && b.getType() === StringValue) {
      let pa = getKnownStringPrefix(a, depth + 1);
      return a instanceof StringValue ? pa + getKnownStringPrefix(b, depth + 1) : pa;
    }
  }
  return "";
}

function getKnownStringSuffix(v: Value, depth: number = 0): string {
  if (depth > 8) return "";
  if (v instanceof StringValue) return v.value;
  if (v instanceof AbstractValue && v.getType() === StringValue && v.kind === "+" && v.args.length === 2) {
    let [a, b] = v.args;
    if (a.getType() === StringValue && b.getType() === StringValue) {
      let sb = getKnownStringSuffix(b, depth + 1);
      return b instanceof StringValue ? getKnownStringSuffix(a, depth + 1) + sb : sb;
    }
  }
  return "";
}

function areStringsDisjointByAffix(x: Value, y: Value): boolean {
  let px = getKnownStringPrefix(x);
  let py = getKnownStringPrefix(y);
  let minP = Math.min(px.length, py.length);
  if (minP > 0 && px.slice(0, minP) !== py.slice(0, minP)) return true;
  if (x instanceof StringValue && x.value.length < py.length) return true;
  if (y instanceof StringValue && y.value.length < px.length) return true;

  let sx = getKnownStringSuffix(x);
  let sy = getKnownStringSuffix(y);
  let minS = Math.min(sx.length, sy.length);
  if (minS > 0 && sx.slice(sx.length - minS) !== sy.slice(sy.length - minS)) return true;
  if (x instanceof StringValue && x.value.length < sy.length) return true;
  if (y instanceof StringValue && y.value.length < sx.length) return true;
  return false;
}

function simplifyEquality(realm: Realm, equality: AbstractValue, depth: number): Value {
  let loc = equality.expressionLocation;
  let op = equality.kind;
  let [x, y] = equality.args;
  if (x instanceof EmptyValue || y instanceof EmptyValue) return equality;
  if (x instanceof ConcreteValue) [x, y] = [y, x];
  if (
    (op === "===" || op === "==" || op === "!==" || op === "!=") &&
    x.getType() === StringValue &&
    y.getType() === StringValue &&
    areStringsDisjointByAffix(x, y)
  ) {
    return op === "===" || op === "==" ? realm.intrinsics.false : realm.intrinsics.true;
  }
  if (op === "===" || op === "==" || op === "!==" || op === "==") {
    if (!x.mightNotBeNull()) {
      let sy = simplifyNullCheck(realm, op, y, depth + 1);
      if (sy !== undefined) return sy;
    }
    if (!y.mightNotBeNull()) {
      let sx = simplifyNullCheck(realm, op, x, depth + 1);
      if (sx !== undefined) return sx;
    }
    if (!x.mightNotBeUndefined()) {
      let sy = simplifyUndefinedCheck(realm, op, y, depth + 1);
      if (sy !== undefined) return sy;
    }
    if (!y.mightNotBeUndefined()) {
      let sx = simplifyUndefinedCheck(realm, op, x, depth + 1);
      if (sx !== undefined) return sx;
    }
  }
  if (op === "===" || op === "!==" || op === "==" || op === "!=") {
    // String prefix/suffix disjointness: `("prefix" + s) === "other"` is false when `!"other".startsWith("prefix")`
    // (provided `s` is a known string so `+` is string concatenation with no coercion).
    if (y instanceof StringValue && x instanceof AbstractValue && x.kind === "+" && x.args.length === 2) {
      let [xa, xb] = x.args;
      if (xa instanceof StringValue && xb.getType() === StringValue && !y.value.startsWith(xa.value)) {
        return op[0] === "!" ? realm.intrinsics.true : realm.intrinsics.false;
      }
      if (xb instanceof StringValue && xa.getType() === StringValue && !y.value.endsWith(xb.value)) {
        return op[0] === "!" ? realm.intrinsics.true : realm.intrinsics.false;
      }
    }
  }
  if (op === "===") {
    let xType = x.getType();
    let yType = y.getType();
    if (
      xType !== yType &&
      xType !== Value &&
      xType !== PrimitiveValue &&
      yType !== Value &&
      yType !== PrimitiveValue &&
      !(Value.isTypeCompatibleWith(xType, NumberValue) && Value.isTypeCompatibleWith(yType, NumberValue)) &&
      !(Value.isTypeCompatibleWith(xType, ObjectValue) && Value.isTypeCompatibleWith(yType, ObjectValue))
    ) {
      return realm.intrinsics.false;
    }
    if (x instanceof AbstractValue && x.kind === "conditional") {
      let [cond, xx, xy] = x.args;
      // ((cond ? xx : xy) === y) && xx === y && xy !== y <=> Boolean(cond)
      if (strictlyAlwaysEqual(realm, xx, y, depth) && strictlyAlwaysNotEqual(realm, xy, y, depth))
        return makeBoolean(realm, cond, loc);
      // ((cond ? xx : xy) === y) && xx !== y && xy === y <=> !cond
      if (strictlyAlwaysNotEqual(realm, xx, y, depth) && strictlyAlwaysEqual(realm, xy, y, depth))
        return negate(realm, cond, depth + 1, loc);
    } else if (y instanceof AbstractValue && y.kind === "conditional") {
      let [cond, yx, yy] = y.args;
      // (x === (cond ? yx : yy)) && x === yx && x !== yy <=> Boolean(cond)
      if (strictlyAlwaysEqual(realm, yx, x, depth) && strictlyAlwaysNotEqual(realm, yy, x, depth))
        return makeBoolean(realm, cond, loc);
      // (x === (cond ? yx : yy)) && x !== yx && x === yy <=> !cond
      if (strictlyAlwaysNotEqual(realm, x, yx, depth) && strictlyAlwaysEqual(realm, x, yy, depth))
        return negate(realm, cond, depth + 1, loc);
    }
  } else if (op === "==") {
    let xType = x.getType();
    let xIsNullOrUndefined = xType === NullValue || xType === UndefinedValue;
    let yType = y.getType();
    let yIsNullOrUndefined = yType === NullValue || yType === UndefinedValue;
    // If x and y are both known to be null/undefined we should never get here because both should be concrete values.
    invariant(!xIsNullOrUndefined || !yIsNullOrUndefined);
    if (xIsNullOrUndefined) {
      return yType === Value || yType === PrimitiveValue ? equality : realm.intrinsics.false;
    }
    if (yIsNullOrUndefined) {
      return xType === Value || xType === PrimitiveValue ? equality : realm.intrinsics.false;
    }
  }
  return equality;
}

function makeBoolean(realm: Realm, value: Value, loc: ?BabelNodeSourceLocation = undefined): Value {
  if (value.getType() === BooleanValue) return value;
  if (value instanceof ConcreteValue) return new BooleanValue(realm, To.ToBoolean(realm, value));
  invariant(value instanceof AbstractValue);
  let v = AbstractValue.createFromUnaryOp(realm, "!", value, true, value.expressionLocation);
  if (v instanceof ConcreteValue) return new BooleanValue(realm, !To.ToBoolean(realm, v));
  invariant(v instanceof AbstractValue);
  return AbstractValue.createFromUnaryOp(realm, "!", v, true, loc || value.expressionLocation);
}

function negate(
  realm: Realm,
  value: Value,
  depth: number = 0,
  loc: ?BabelNodeSourceLocation = undefined,
  unsimplifiedNegation: void | Value = undefined,
  isCondition?: boolean
): Value {
  if (value instanceof ConcreteValue) return ValuesDomain.computeUnary(realm, "!", value);
  invariant(value instanceof AbstractValue);
  if (depth > 3) {
    if (unsimplifiedNegation !== undefined) return unsimplifiedNegation;
    return AbstractValue.createFromUnaryOp(realm, "!", value, true, loc || value.expressionLocation, isCondition, true);
  }
  value = simplify(realm, value, true, depth + 1);
  if (!value.mightNotBeTrue()) return realm.intrinsics.false;
  if (!value.mightNotBeFalse()) return realm.intrinsics.true;
  invariant(value instanceof AbstractValue);
  if (value.kind === "!") {
    let [x] = value.args;
    if (isCondition || x.getType() === BooleanValue) return simplify(realm, x, !!isCondition, depth + 1);
    if (unsimplifiedNegation !== undefined) return unsimplifiedNegation;
    return makeBoolean(realm, x, loc);
  }
  // Invert binary comparisons only when NaN cannot make both sides false.
  if (value.args.length === 2) {
    let [arg0, arg1] = value.args;
    let coercesToNonNaNNumber = (v: Value): boolean => {
      let t = v.getType();
      if (t === BooleanValue || t === NullValue || t === IntegralValue) return true;
      if (!Value.isTypeCompatibleWith(t, NumberValue)) return false;
      let iv = IntervalDomain.of(v);
      return iv !== undefined && !iv.mayBeNaN;
    };
    let canInvertStrictEq =
      !arg0.mightBeNumber() || !arg1.mightBeNumber() || coercesToNonNaNNumber(arg0) || coercesToNonNaNNumber(arg1);
    let canInvertRelational =
      (arg0.getType() === StringValue && arg1.getType() === StringValue) ||
      (coercesToNonNaNNumber(arg0) && coercesToNonNaNNumber(arg1));
    let invertedComparison;
    switch (value.kind) {
      case "===":
        if (canInvertStrictEq) invertedComparison = "!==";
        break;
      case "==":
        invertedComparison = "!=";
        break;
      case "!==":
        if (canInvertStrictEq) invertedComparison = "===";
        break;
      case "!=":
        invertedComparison = "==";
        break;
      case "<":
        if (canInvertRelational) invertedComparison = ">=";
        break;
      case "<=":
        if (canInvertRelational) invertedComparison = ">";
        break;
      case ">":
        if (canInvertRelational) invertedComparison = "<=";
        break;
      case ">=":
        if (canInvertRelational) invertedComparison = "<";
        break;
      default:
        break;
    }
    if (invertedComparison !== undefined) {
      let left = simplify(realm, arg0, false, depth + 1);
      let right = simplify(realm, arg1, false, depth + 1);
      return AbstractValue.createFromBinaryOp(realm, invertedComparison, left, right, loc || value.expressionLocation);
    }
    if (!arg0.mightBeNumber() && !arg1.mightBeNumber()) {
      let invertedLogicalOp;
      switch (value.kind) {
        case "&&":
          invertedLogicalOp = "||";
          break;
        case "||":
          invertedLogicalOp = "&&";
          break;
        default:
          break;
      }
      if (invertedLogicalOp !== undefined) {
        let left = negate(realm, arg0, depth + 1, undefined, undefined, isCondition);
        let right = negate(realm, arg1, depth + 1, undefined, undefined, isCondition);
        return AbstractValue.createFromLogicalOp(
          realm,
          invertedLogicalOp,
          left,
          right,
          loc || value.expressionLocation,
          isCondition,
          depth > 1
        );
      }
    }
  }
  if (unsimplifiedNegation !== undefined) return unsimplifiedNegation;
  return AbstractValue.createFromUnaryOp(realm, "!", value, true, loc || value.expressionLocation, isCondition, true);
}

function cannotBeNaN(v: Value): boolean {
  if (!v.mightBeNumber()) return true;
  if (v instanceof NumberValue) return !Number.isNaN(v.value);
  let iv = IntervalDomain.of(v);
  if (iv !== undefined && !iv.mayBeNaN) return true;
  if (v instanceof AbstractValue && !v.values.isTop()) {
    for (let e of v.values.getElements()) {
      if (e instanceof NumberValue && Number.isNaN(e.value)) return false;
    }
    return true;
  }
  return false;
}

function strictlyAlwaysEqual(realm: Realm, u: Value, v: Value, depth: number): boolean {
  if (u instanceof ConcreteValue && v instanceof ConcreteValue) {
    return u instanceof NumberValue && v instanceof NumberValue ? u.value === v.value : u.equals(v);
  }
  if (!u.equals(v)) return false;
  if (cannotBeNaN(v)) return true;
  let selfEq = AbstractValue.createFromBinaryOp(realm, "===", v, v, undefined, undefined, true, true);
  return Path.implies(selfEq, depth + 1);
}

function strictlyAlwaysNotEqual(realm: Realm, u: Value, v: Value, depth: number): boolean {
  if (u instanceof ConcreteValue && v instanceof ConcreteValue) {
    return !(u instanceof NumberValue && v instanceof NumberValue ? u.value === v.value : u.equals(v));
  }
  let uType = u.getType();
  let vType = v.getType();
  if (
    uType !== vType &&
    uType !== Value &&
    uType !== PrimitiveValue &&
    vType !== Value &&
    vType !== PrimitiveValue &&
    !(Value.isTypeCompatibleWith(uType, NumberValue) && Value.isTypeCompatibleWith(vType, NumberValue)) &&
    !(Value.isTypeCompatibleWith(uType, ObjectValue) && Value.isTypeCompatibleWith(vType, ObjectValue))
  ) {
    return true;
  }
  let neq = AbstractValue.createFromBinaryOp(realm, "!==", u, v, undefined, undefined, true, true);
  return Path.implies(neq, depth + 1);
}
