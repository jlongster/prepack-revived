/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import type { BabelBinaryOperator, BabelLogicalOperator, BabelUnaryOperator } from "@babel/types";
import { AbruptCompletion } from "../completions.js";
import { FatalError } from "../errors.js";
import invariant from "../invariant.js";
import {
  AbstractEqualityComparison,
  AbstractRelationalComparison,
  Add,
  HasProperty,
  InstanceofOperator,
  StrictEqualityComparison,
} from "../methods/index.js";
import type { Realm } from "../realm.js";
import { To } from "../singletons.js";
import {
  AbstractValue,
  BigIntValue,
  bigIntPow,
  BooleanValue,
  ConcreteValue,
  EmptyValue,
  HostBigInt,
  NumberValue,
  IntegralValue,
  ObjectValue,
  StringValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { Utils } from "../singletons.js";

/* An abstract domain that collects together a set of concrete values
   that might be the value of a variable at runtime.
   Initially, every variable has the value undefined.
   A property that has been weakly deleted will have more than
   one value, one of which will by the EmptyValue.  */

export default class ValuesDomain {
  constructor(_values: void | Set<ConcreteValue> | ConcreteValue) {
    let values = _values;
    if (values instanceof ConcreteValue) {
      let valueSet = new Set();
      valueSet.add(values);
      values = valueSet;
    }
    this._elements = values;
  }

  static topVal: ValuesDomain;
  static bottomVal: ValuesDomain;

  _elements: void | Set<ConcreteValue>;

  contains(x: ValuesDomain): boolean {
    let elems = this._elements;
    let xelems = x._elements;
    if (elems === xelems) return true;
    if (elems === undefined) return true;
    if (xelems === undefined) return false;
    if (elems.size < xelems.size) return false;
    for (let e of xelems) {
      if (!elems.has(e)) return false;
    }
    return true;
  }

  containsValue(x: Value): boolean {
    let elems = this._elements;
    if (elems === undefined) return true; // Top contains everything
    if (x instanceof AbstractValue) return this.contains(x.values);
    invariant(x instanceof ConcreteValue);
    return elems.has(x);
  }

  isBottom(): boolean {
    return this._elements !== undefined && this._elements.size === 0;
  }

  isTop(): boolean {
    return this._elements === undefined;
  }

  getElements(): Set<ConcreteValue> {
    invariant(this._elements !== undefined);
    return this._elements;
  }

  // return a set of values that may be result of performing the given operation on each pair in the
  // Cartesian product of the value sets of the operands.
  static binaryOp(realm: Realm, op: BabelBinaryOperator, left: ValuesDomain, right: ValuesDomain): ValuesDomain {
    if (left.isBottom() || right.isBottom()) return ValuesDomain.bottomVal;
    let leftElements = left._elements;
    let rightElements = right._elements;
    // Return top if left and/or right are top or if the size of the value set would get to be quite large.
    // Note: the larger the set of values, the less we know and therefore the less we get value from computing
    // all of these values. TODO #1000: probably the upper bound can be quite a bit smaller.
    if (!leftElements || !rightElements || leftElements.size > 100 || rightElements.size > 100)
      return ValuesDomain.topVal;
    let resultSet: Set<ConcreteValue> = new Set();
    let savedHandler = realm.errorHandler;
    let savedIsReadOnly = realm.isReadOnly;
    realm.isReadOnly = true;
    try {
      realm.errorHandler = () => {
        throw new FatalError();
      };
      for (let leftElem of leftElements) {
        for (let rightElem of rightElements) {
          let result = ValuesDomain.computeBinary(realm, op, leftElem, rightElem);
          if (result instanceof ConcreteValue) {
            resultSet.add(result);
          } else {
            invariant(result instanceof AbstractValue);
            if (result.values.isTop()) {
              return ValuesDomain.topVal;
            }
            for (let subResult of result.values.getElements()) {
              resultSet.add(subResult);
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof AbruptCompletion) return ValuesDomain.topVal;
    } finally {
      realm.errorHandler = savedHandler;
      realm.isReadOnly = savedIsReadOnly;
    }
    return new ValuesDomain(resultSet);
  }

  // Note that calling this can result in user code running, which can side-effect the heap.
  // If that is not the desired behavior, mark the realm as read-only for the duration of the call.
  static computeBinary(realm: Realm, op: BabelBinaryOperator, lval: ConcreteValue, rval: ConcreteValue): Value {
    if (op === "+") {
      // ECMA262 12.8.3 The Addition Operator
      let lprim = To.ToPrimitiveOrAbstract(realm, lval);
      let rprim = To.ToPrimitiveOrAbstract(realm, rval);

      if (lprim instanceof AbstractValue || rprim instanceof AbstractValue) {
        return AbstractValue.createFromBinaryOp(realm, op, lprim, rprim);
      }

      if (lprim instanceof StringValue || rprim instanceof StringValue) {
        let lstr = To.ToString(realm, lprim);
        let rstr = To.ToString(realm, rprim);
        return new StringValue(realm, lstr + rstr);
      }

      if (lprim instanceof BigIntValue || rprim instanceof BigIntValue) {
        if (!(lprim instanceof BigIntValue && rprim instanceof BigIntValue)) {
          throw realm.createErrorThrowCompletion(
            realm.intrinsics.TypeError,
            "Cannot mix BigInt and other types, use explicit conversions"
          );
        }
        return new BigIntValue(realm, lprim.value + rprim.value);
      }

      let lnum = To.ToNumber(realm, lprim);
      let rnum = To.ToNumber(realm, rprim);
      return Add(realm, lnum, rnum);
    } else if (
      op === "-" ||
      op === "*" ||
      op === "/" ||
      op === "%" ||
      op === "**" ||
      op === "<<" ||
      op === ">>" ||
      op === ">>>" ||
      op === "&" ||
      op === "|" ||
      op === "^"
    ) {
      let lprim = lval instanceof ObjectValue ? To.ToPrimitiveOrAbstract(realm, lval, "number") : lval;
      let rprim = rval instanceof ObjectValue ? To.ToPrimitiveOrAbstract(realm, rval, "number") : rval;
      if (lprim instanceof BigIntValue || rprim instanceof BigIntValue) {
        if (lprim instanceof AbstractValue || rprim instanceof AbstractValue) {
          throw new FatalError();
        }
        if (!(lprim instanceof BigIntValue && rprim instanceof BigIntValue)) {
          // Ensure symbol still throws TypeError via ToNumeric on the non-BigInt operand first if needed
          if (!(lprim instanceof BigIntValue)) To.ToNumeric(realm, lprim);
          if (!(rprim instanceof BigIntValue)) To.ToNumeric(realm, rprim);
          throw realm.createErrorThrowCompletion(
            realm.intrinsics.TypeError,
            "Cannot mix BigInt and other types, use explicit conversions"
          );
        }
        let a = lprim.value;
        let b = rprim.value;
        if (op === ">>>") {
          throw realm.createErrorThrowCompletion(
            realm.intrinsics.TypeError,
            "BigInts have no unsigned right shift, use >> instead"
          );
        }
        if ((op === "/" || op === "%") && b === HostBigInt(0)) {
          throw realm.createErrorThrowCompletion(realm.intrinsics.RangeError, "Division by zero");
        }
        if (op === "**" && b < HostBigInt(0)) {
          throw realm.createErrorThrowCompletion(realm.intrinsics.RangeError, "Exponent must be positive");
        }
        try {
          if (op === "-") return new BigIntValue(realm, a - b);
          if (op === "*") return new BigIntValue(realm, a * b);
          if (op === "/") return new BigIntValue(realm, a / b);
          if (op === "%") return new BigIntValue(realm, a % b);
          if (op === "**") return new BigIntValue(realm, bigIntPow(a, b));
          if (op === "<<") return new BigIntValue(realm, a << b);
          if (op === ">>") return new BigIntValue(realm, a >> b);
          if (op === "&") return new BigIntValue(realm, a & b);
          if (op === "|") return new BigIntValue(realm, a | b);
          if (op === "^") return new BigIntValue(realm, a ^ b);
        } catch (e) {
          if (e instanceof RangeError) {
            throw realm.createErrorThrowCompletion(realm.intrinsics.RangeError, e.message);
          }
          throw e;
        }
      }
      lval = lprim instanceof ConcreteValue ? lprim : lval;
      rval = rprim instanceof ConcreteValue ? rprim : rval;
      if (op === ">>>") {
        let lnum = To.ToUint32(realm, lprim);
        let rnum = To.ToUint32(realm, rprim);
        return IntegralValue.createFromNumberValue(realm, lnum >>> rnum);
      } else if (op === "<<" || op === ">>") {
        let lnum = To.ToInt32(realm, lprim);
        let rnum = To.ToUint32(realm, rprim);
        return IntegralValue.createFromNumberValue(realm, op === "<<" ? lnum << rnum : lnum >> rnum);
      } else if (op === "**") {
        let base = To.ToNumberOrAbstract(realm, lprim);
        let exponent = To.ToNumberOrAbstract(realm, rprim);
        if (base instanceof AbstractValue || exponent instanceof AbstractValue) {
          const baseVal = base instanceof AbstractValue ? base : new NumberValue(realm, base);
          const exponentVal = exponent instanceof AbstractValue ? exponent : new NumberValue(realm, exponent);
          return AbstractValue.createFromBinaryOp(realm, op, baseVal, exponentVal);
        }
        return new NumberValue(realm, Math.pow(base, exponent));
      } else if (op === "&" || op === "|" || op === "^") {
        let lnum: number = To.ToInt32(realm, lprim);
        let rnum: number = To.ToInt32(realm, rprim);
        if (op === "&") return IntegralValue.createFromNumberValue(realm, lnum & rnum);
        if (op === "|") return IntegralValue.createFromNumberValue(realm, lnum | rnum);
        return IntegralValue.createFromNumberValue(realm, lnum ^ rnum);
      } else {
        let lnum = To.ToNumberOrAbstract(realm, lprim);
        let rnum = To.ToNumberOrAbstract(realm, rprim);
        if (lnum instanceof AbstractValue || rnum instanceof AbstractValue) {
          const lnumVal = lnum instanceof AbstractValue ? lnum : new NumberValue(realm, lnum);
          const rnumVal = rnum instanceof AbstractValue ? rnum : new NumberValue(realm, rnum);
          return AbstractValue.createFromBinaryOp(realm, op, lnumVal, rnumVal);
        }
        if (isNaN(rnum) || isNaN(lnum)) return realm.intrinsics.NaN;
        if (op === "-") return Add(realm, lnum, rnum, true);
        if (op === "%") return new NumberValue(realm, lnum % rnum);
        if (op === "/") return new NumberValue(realm, lnum / rnum);
        return new NumberValue(realm, lnum * rnum);
      }
    } else if (op === "<" || op === ">" || op === ">=" || op === "<=") {
      // ECMA262 12.10.3
      if (op === "<") {
        let r = AbstractRelationalComparison(realm, lval, rval, true, op);
        if (r instanceof UndefinedValue) {
          return realm.intrinsics.false;
        } else {
          return r;
        }
      } else if (op === "<=") {
        let r = AbstractRelationalComparison(realm, rval, lval, false, op);
        if (r instanceof UndefinedValue || (r instanceof BooleanValue && r.value)) {
          return realm.intrinsics.false;
        } else if (r instanceof AbstractValue) {
          return r;
        } else {
          return realm.intrinsics.true;
        }
      } else if (op === ">") {
        let r = AbstractRelationalComparison(realm, rval, lval, false, op);
        if (r instanceof UndefinedValue) {
          return realm.intrinsics.false;
        } else {
          return r;
        }
      } else if (op === ">=") {
        let r = AbstractRelationalComparison(realm, lval, rval, true, op);
        if (r instanceof UndefinedValue || (r instanceof BooleanValue && r.value)) {
          return realm.intrinsics.false;
        } else if (r instanceof AbstractValue) {
          return r;
        } else {
          return realm.intrinsics.true;
        }
      }
    } else if (op === "!==") {
      return new BooleanValue(realm, !StrictEqualityComparison(realm, lval, rval));
    } else if (op === "===") {
      return new BooleanValue(realm, StrictEqualityComparison(realm, lval, rval));
    } else if (op === "!=" || op === "==") {
      return AbstractEqualityComparison(realm, lval, rval, op);
    } else if (op === "in") {
      // ECMA262 12.10.3

      // 5. If Type(rval) is not Object, throw a TypeError exception.
      if (!(rval instanceof ObjectValue)) {
        throw new FatalError();
      }

      // 6. Return ? HasProperty(rval, ToPropertyKey(lval)).
      return new BooleanValue(realm, HasProperty(realm, rval, To.ToPropertyKey(realm, lval)));
    } else if (op === "instanceof") {
      // ECMA262 12.10.3

      // 5. Return ? InstanceofOperator(lval, rval).;
      return new BooleanValue(realm, InstanceofOperator(realm, lval, rval));
    }

    invariant(false, "unimplemented " + op);
  }

  static logicalOp(realm: Realm, op: BabelLogicalOperator, left: ValuesDomain, right: ValuesDomain): ValuesDomain {
    let leftElements = left._elements;
    let rightElements = right._elements;
    // Return top if left and/or right are top or if the size of the value set would get to be quite large.
    // Note: the larger the set of values, the less we know and therefore the less we get value from computing
    // all of these values. TODO #1000: probably the upper bound can be quite a bit smaller.
    if (!leftElements || !rightElements || leftElements.size > 100 || rightElements.size > 100)
      return ValuesDomain.topVal;
    let resultSet = new Set();
    let savedHandler = realm.errorHandler;
    let savedIsReadOnly = realm.isReadOnly;
    realm.isReadOnly = true;
    try {
      realm.errorHandler = () => {
        throw new FatalError();
      };
      for (let leftElem of leftElements) {
        for (let rightElem of rightElements) {
          let result = ValuesDomain.computeLogical(realm, op, leftElem, rightElem);
          resultSet.add(result);
        }
      }
    } catch (e) {
      if (e instanceof AbruptCompletion) return ValuesDomain.topVal;
    } finally {
      realm.errorHandler = savedHandler;
      realm.isReadOnly = savedIsReadOnly;
    }
    return new ValuesDomain(resultSet);
  }

  // Note that calling this can result in user code running, which can side-effect the heap.
  // If that is not the desired behavior, mark the realm as read-only for the duration of the call.
  static computeLogical(
    realm: Realm,
    op: BabelLogicalOperator,
    lval: ConcreteValue,
    rval: ConcreteValue
  ): ConcreteValue {
    let lbool = To.ToBoolean(realm, lval);

    if (op === "&&") {
      // ECMA262 12.13.3
      if (lbool === false) return lval;
    } else if (op === "||") {
      // ECMA262 12.13.3
      if (lbool === true) return lval;
    }
    return rval;
  }

  // Note that calling this can result in user code running, which can side-effect the heap.
  // If that is not the desired behavior, mark the realm as read-only for the duration of the call.
  static computeUnary(realm: Realm, op: BabelUnaryOperator, value: ConcreteValue): Value {
    if (op === "+") {
      // ECMA262 12.5.6.1
      // 1. Let expr be the result of evaluating UnaryExpression.
      // 2. Return ? ToNumber(? GetValue(expr)).
      return IntegralValue.createFromNumberValue(realm, To.ToNumber(realm, value));
    } else if (op === "-") {
      // ECMA262 12.5.7.1
      // 1. Let expr be the result of evaluating UnaryExpression.
      // 2. Let oldValue be ? ToNumber(? GetValue(expr)).
      let oldValue = To.ToNumber(realm, value);

      // 3. If oldValue is NaN, return NaN.
      if (isNaN(oldValue)) {
        return realm.intrinsics.NaN;
      }

      // 4. Return the result of negating oldValue; that is, compute a Number with the same magnitude but opposite sign.
      return IntegralValue.createFromNumberValue(realm, -oldValue);
    } else if (op === "~") {
      // ECMA262 12.5.8
      // 1. Let expr be the result of evaluating UnaryExpression.
      // 2. Let oldValue be ? ToInt32(? GetValue(expr)).
      let oldValue = To.ToInt32(realm, value);

      // 3. Return the result of applying bitwise complement to oldValue. The result is a signed 32-bit integer.
      return IntegralValue.createFromNumberValue(realm, ~oldValue);
    } else if (op === "!") {
      // ECMA262 12.6.9
      // 1. Let expr be the result of evaluating UnaryExpression.
      // 2. Let oldValue be ToBoolean(? GetValue(expr)).
      let oldValue = To.ToBoolean(realm, value);

      // 3. If oldValue is true, return false.
      if (oldValue === true) return realm.intrinsics.false;

      // 4. Return true.
      return realm.intrinsics.true;
    } else if (op === "void") {
      // 1. Let expr be the result of evaluating UnaryExpression.
      // 2. Perform ? GetValue(expr).
      // 3. Return undefined.
      return realm.intrinsics.undefined;
    } else if (op === "typeof") {
      // ECMA262 12.6.5
      // 1. Let val be the result of evaluating UnaryExpression.
      // 2. If Type(val) is Reference, then
      // 3. Let val be ? GetValue(val).
      let val = value;
      // 4. Return a String according to Table 35.
      let typeString = Utils.typeToString(val.getType());
      invariant(typeString !== undefined);
      return new StringValue(realm, typeString);
    } else {
      invariant(false, `${op} is a state update, not a pure operation, so we don't support it`);
    }
  }

  static unaryOp(realm: Realm, op: BabelUnaryOperator, operandValues: ValuesDomain): ValuesDomain {
    if (operandValues.isBottom()) return ValuesDomain.bottomVal;
    let operandElements = operandValues._elements;
    if (operandElements === undefined) return ValuesDomain.topVal;
    let resultSet = new Set();
    let savedHandler = realm.errorHandler;
    let savedIsReadOnly = realm.isReadOnly;
    realm.isReadOnly = true;
    try {
      realm.errorHandler = () => {
        throw new FatalError();
      };
      for (let operandElem of operandElements) {
        let result = ValuesDomain.computeUnary(realm, op, operandElem);
        if (result instanceof ConcreteValue) {
          resultSet.add(result);
        } else {
          invariant(result instanceof AbstractValue);
          if (result.values.isTop()) {
            return ValuesDomain.topVal;
          }
          for (let subResult of result.values.getElements()) {
            resultSet.add(subResult);
          }
        }
      }
    } catch (e) {
      if (e instanceof AbruptCompletion) return ValuesDomain.topVal;
    } finally {
      realm.errorHandler = savedHandler;
      realm.isReadOnly = savedIsReadOnly;
    }
    return new ValuesDomain(resultSet);
  }

  includesValueNotOfType(type: typeof Value): boolean {
    invariant(!this.isTop());
    for (let cval of this.getElements()) {
      if (!(cval instanceof type)) return true;
    }
    return false;
  }

  includesValueOfType(type: typeof Value): boolean {
    invariant(!this.isTop());
    for (let cval of this.getElements()) {
      if (cval instanceof type) return true;
    }
    return false;
  }

  mightBeFalse(): boolean {
    invariant(!this.isTop());
    for (let cval of this.getElements()) {
      if (cval.mightBeFalse()) return true;
    }
    return false;
  }

  mightNotBeFalse(): boolean {
    invariant(!this.isTop());
    for (let cval of this.getElements()) {
      if (cval.mightNotBeFalse()) return true;
    }
    return false;
  }

  static joinValues(
    realm: Realm,
    v1: Value = realm.intrinsics.undefined,
    v2: Value = realm.intrinsics.undefined
  ): ValuesDomain {
    if (v1 instanceof AbstractValue) return v1.values.joinWith(v2);
    if (v2 instanceof AbstractValue) return v2.values.joinWith(v1);
    let union = new Set();
    invariant(v1 instanceof ConcreteValue);
    union.add(v1);
    invariant(v2 instanceof ConcreteValue);
    union.add(v2);
    return new ValuesDomain(union);
  }

  joinWith(y: Value): ValuesDomain {
    if (this.isTop()) return this;
    let union = new Set(this.getElements());
    if (y instanceof AbstractValue) {
      if (y.values.isTop()) return y.values;
      y.values.getElements().forEach(v => union.add(v));
    } else {
      invariant(y instanceof ConcreteValue);
      union.add(y);
    }
    if (union.size === 0) return ValuesDomain.bottomVal;
    return new ValuesDomain(union);
  }

  static meetValues(
    realm: Realm,
    v1: Value = realm.intrinsics.undefined,
    v2: Value = realm.intrinsics.undefined
  ): ValuesDomain {
    if (v1 instanceof AbstractValue) return v1.values.meetWith(v2);
    if (v2 instanceof AbstractValue) return v2.values.meetWith(v1);
    let intersection = new Set();
    invariant(v1 instanceof ConcreteValue);
    invariant(v2 instanceof ConcreteValue);
    if (v1 === v2) intersection.add(v1);
    if (intersection.size === 0) return ValuesDomain.bottomVal;
    return new ValuesDomain(intersection);
  }

  meetWith(y: Value): ValuesDomain {
    let intersection = new Set();
    let elements = this._elements;
    if (y instanceof AbstractValue) {
      if (y.values.isTop()) return this;
      y.values.getElements().forEach(v => {
        if (elements === undefined || elements.has(v)) intersection.add(v);
      });
    } else {
      invariant(y instanceof ConcreteValue);
      if (elements === undefined || elements.has(y)) intersection.add(y);
    }
    if (intersection.size === 0) return ValuesDomain.bottomVal;
    return new ValuesDomain(intersection);
  }

  promoteEmptyToUndefined(): ValuesDomain {
    if (this.isTop() || this.isBottom()) return this;
    let newSet = new Set();
    for (let cval of this.getElements()) {
      if (cval instanceof EmptyValue) newSet.add(cval.$Realm.intrinsics.undefined);
      else newSet.add(cval);
    }
    return new ValuesDomain(newSet);
  }
}
