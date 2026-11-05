/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

/*
 * Effect summaries for built-in functions.
 *
 * A summary describes what a built-in does with its receiver and arguments, so that a call with
 * abstract inputs can be residualized as an abstract value of the right type instead of failing
 * (and, in pure scope, being treated as a call to unknown code that leaks all of its arguments).
 *
 * Each input is classified by how the built-in consumes it (see `InputKind`):
 * - "pure": consuming it cannot run user code, throw or touch the heap.
 * - "throws": consuming it might throw (e.g. ToNumber on a symbol), but cannot run user code.
 * - "user": consuming it might run user code (e.g. valueOf/toString/@@toPrimitive on an object).
 * - "bail": the summary does not apply; the native implementation runs as before.
 *
 * If every input is pure and the built-in itself cannot throw, the call becomes a pure abstract
 * value built from a template. Otherwise, in pure scope only, it becomes a temporal abstract value
 * that may throw; inputs classified as "user" are leaked because their coercion methods run
 * unknown code. Outside pure scope such calls keep the old behavior.
 *
 * Summaries only engage when at least one consumed input is abstract, so concrete calls are still
 * evaluated by the native implementation.
 */

import type { Realm } from "../realm.js";
import type { Intrinsics } from "../types.js";
import {
  AbstractValue,
  ArrayValue,
  BooleanValue,
  ConcreteValue,
  EmptyValue,
  NativeFunctionValue,
  NullValue,
  NumberValue,
  ObjectValue,
  PrimitiveValue,
  StringValue,
  SymbolValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { Leak } from "../singletons.js";
import { PropertyDescriptor } from "../descriptors.js";
import { StrictEqualityComparison } from "../methods/abstract.js";
import { Placeholders } from "../utils/PreludeGenerator.js";
import invariant from "../invariant.js";

// How a built-in consumes an input.
// - "number": ToNumber and friends (ToInteger, ToInt32, ToUint32, ToLength). Objects run user code, symbols throw.
// - "string": ToString. Objects run user code, symbols throw.
// - "string-or-symbol": like "string" but symbols are fine (String(sym) does not throw).
// - "json": JSON.stringify's value. Primitives are fine (symbols give undefined), objects run user code (toJSON, getters, proxies).
// - "none": the value is not read at all, or only compared by identity.
type InputKind = "number" | "string" | "string-or-symbol" | "json" | "none";

// How a built-in consumes its receiver.
// - "ignored": the receiver is not used (static functions).
// - "string": RequireObjectCoercible(this) then ToString(this).
// - "number": thisNumberValue(this). Only primitive numbers are summarized.
type ReceiverKind = "ignored" | "string" | "number";

type Classification = "pure" | "throws" | "user" | "bail";

export type BuiltinSummary = {|
  receiver?: ReceiverKind,
  args: Array<InputKind>,
  // How arguments beyond `args` are consumed. They are ignored by most built-ins.
  rest?: InputKind,
  result: typeof Value,
  // Whether the built-in might throw for some primitive inputs (e.g. a RangeError for a bad radix).
  // Gets the original (unpadded) argument list.
  mayThrow?: (args: Array<Value>) => boolean,
  // Extra precondition; the native implementation runs when it returns false.
  applies?: (args: Array<Value>) => boolean,
  // Refines the result type from the arguments.
  resultType?: (args: Array<Value>) => typeof Value,
|};

export type CustomSummary = (
  realm: Realm,
  context: Value,
  args: Array<Value>,
  func: NativeFunctionValue
) => void | Value;

const unaryNumber = { args: ["number"], rest: "none", result: NumberValue };
const binaryNumber = { args: ["number", "number"], rest: "none", result: NumberValue };
const variadicNumber = { args: [], rest: "number", result: NumberValue };
// The native implementations already fold to false for values that cannot be numbers.
const numberPredicate = {
  args: ["none"],
  rest: "none",
  result: BooleanValue,
  applies: args => args.length > 0 && args[0].mightBeNumber(),
};

function concreteIntegerIn(min: number, max: number): (args: Array<Value>) => boolean {
  // The argument is absent/undefined or a concrete number whose ToInteger is in [min, max], so no RangeError.
  return args => {
    let arg = args[0];
    if (arg === undefined || arg instanceof UndefinedValue) return false;
    if (!(arg instanceof NumberValue)) return true;
    let n = isNaN(arg.value) ? 0 : Math.trunc(arg.value);
    return !(n >= min && n <= max);
  };
}

function always(): boolean {
  return true;
}

export const BuiltinSummaries: { [string]: BuiltinSummary } = {
  // ECMA262 18.2.4 / 18.2.5: ToString(string), ToInt32(radix). No exceptions for primitives.
  parseInt: { args: ["string", "number"], rest: "none", result: NumberValue },
  parseFloat: { args: ["string"], rest: "none", result: NumberValue },
  // ECMA262 18.2.2 / 18.2.3: ToNumber(number).
  isNaN: { args: ["number"], rest: "none", result: BooleanValue },
  isFinite: { args: ["number"], rest: "none", result: BooleanValue },
  // ECMA262 18.2.6: may throw URIError on lone surrogates / malformed escapes even for strings.
  encodeURIComponent: { args: ["string"], rest: "none", result: StringValue, mayThrow: always },
  encodeURI: { args: ["string"], rest: "none", result: StringValue, mayThrow: always },
  decodeURIComponent: { args: ["string"], rest: "none", result: StringValue, mayThrow: always },
  decodeURI: { args: ["string"], rest: "none", result: StringValue, mayThrow: always },

  // ECMA262 20.1.1.1 called as a function: ToNumber(value) (0 when absent).
  Number: { args: ["number"], rest: "none", result: NumberValue },
  // ECMA262 20.1.2: no coercion; non-numbers give false.
  "Number.isFinite": numberPredicate,
  "Number.isInteger": numberPredicate,
  "Number.isNaN": numberPredicate,
  "Number.isSafeInteger": numberPredicate,
  // ECMA262 20.1.3.3: ToInteger(fractionDigits), RangeError outside 0..20 (0..100 since ES2018).
  "Number.prototype.toFixed": {
    receiver: "number",
    args: ["number"],
    rest: "none",
    result: StringValue,
    mayThrow: concreteIntegerIn(0, 20),
  },
  // ECMA262 20.1.3.2: RangeError outside 0..20 (0..100 since ES2018).
  "Number.prototype.toExponential": {
    receiver: "number",
    args: ["number"],
    rest: "none",
    result: StringValue,
    mayThrow: concreteIntegerIn(0, 20),
  },
  // ECMA262 20.1.3.5: RangeError outside 1..21 (1..100 since ES2018) unless undefined.
  "Number.prototype.toPrecision": {
    receiver: "number",
    args: ["number"],
    rest: "none",
    result: StringValue,
    mayThrow: concreteIntegerIn(1, 21),
  },
  // ECMA262 20.1.3.6: RangeError for radix outside 2..36 unless undefined.
  "Number.prototype.toString": {
    receiver: "number",
    args: ["number"],
    rest: "none",
    result: StringValue,
    mayThrow: concreteIntegerIn(2, 36),
  },

  // ECMA262 21.1.1.1 called as a function: SymbolDescriptiveString for symbols, else ToString ("" when absent).
  String: { args: ["string-or-symbol"], rest: "none", result: StringValue },
  // ECMA262 21.1.2.1: ToUint16(ToNumber(each)).
  "String.fromCharCode": { args: [], rest: "number", result: StringValue },
  // ECMA262 21.1.3: RequireObjectCoercible(this), ToString(this), then the listed coercions.
  "String.prototype.charAt": { receiver: "string", args: ["number"], rest: "none", result: StringValue },
  "String.prototype.charCodeAt": { receiver: "string", args: ["number"], rest: "none", result: NumberValue },
  // The result is a number or undefined.
  "String.prototype.codePointAt": { receiver: "string", args: ["number"], rest: "none", result: Value },
  "String.prototype.concat": { receiver: "string", args: [], rest: "string", result: StringValue },
  // includes/startsWith/endsWith throw a TypeError if the search value IsRegExp, which needs an object.
  "String.prototype.endsWith": { receiver: "string", args: ["string", "number"], rest: "none", result: BooleanValue },
  "String.prototype.includes": { receiver: "string", args: ["string", "number"], rest: "none", result: BooleanValue },
  "String.prototype.indexOf": { receiver: "string", args: ["string", "number"], rest: "none", result: NumberValue },
  "String.prototype.lastIndexOf": {
    receiver: "string",
    args: ["string", "number"],
    rest: "none",
    result: NumberValue,
  },
  // ECMA262 21.1.3.12: RangeError unless form is undefined or one of the four forms.
  "String.prototype.normalize": {
    receiver: "string",
    args: ["string"],
    rest: "none",
    result: StringValue,
    mayThrow: args => {
      let form = args[0];
      if (form === undefined || form instanceof UndefinedValue) return false;
      return !(form instanceof StringValue && ["NFC", "NFD", "NFKC", "NFKD"].indexOf(form.value) >= 0);
    },
  },
  "String.prototype.padEnd": { receiver: "string", args: ["number", "string"], rest: "none", result: StringValue },
  "String.prototype.padStart": { receiver: "string", args: ["number", "string"], rest: "none", result: StringValue },
  // ECMA262 21.1.3.13: RangeError for negative or infinite counts.
  "String.prototype.repeat": {
    receiver: "string",
    args: ["number"],
    rest: "none",
    result: StringValue,
    mayThrow: args => {
      let count = args[0];
      if (count === undefined || count instanceof UndefinedValue) return false;
      return !(count instanceof NumberValue && (isNaN(count.value) || (count.value > -1 && count.value < 1000)));
    },
  },
  "String.prototype.slice": { receiver: "string", args: ["number", "number"], rest: "none", result: StringValue },
  "String.prototype.startsWith": {
    receiver: "string",
    args: ["string", "number"],
    rest: "none",
    result: BooleanValue,
  },
  "String.prototype.substr": { receiver: "string", args: ["number", "number"], rest: "none", result: StringValue },
  "String.prototype.substring": {
    receiver: "string",
    args: ["number", "number"],
    rest: "none",
    result: StringValue,
  },
  "String.prototype.toLowerCase": { receiver: "string", args: [], rest: "none", result: StringValue },
  "String.prototype.toUpperCase": { receiver: "string", args: [], rest: "none", result: StringValue },
  "String.prototype.trim": { receiver: "string", args: [], rest: "none", result: StringValue },

  // ECMA262 24.3.2: only the single-argument form; the existing implementation handles abstract
  // values with a known template, so this only covers values the implementation cannot handle.
  "JSON.stringify": {
    args: ["json"],
    // A string or undefined (for undefined, functions and symbols, or via toJSON).
    result: Value,
    applies: args => args.length === 1 && !(args[0] instanceof AbstractValue && !args[0].values.isTop()),
    resultType: args => {
      let type = args[0].getType();
      return type === StringValue || type === BooleanValue || type === NullValue || isNumberType(type)
        ? StringValue
        : Value;
    },
  },

  // ECMA262 20.2.2: every Math function applies ToNumber to its declared arguments and ignores the rest
  // (max, min and hypot coerce all of them). None of them throws for primitive non-symbol inputs.
  "Math.abs": unaryNumber,
  "Math.acos": unaryNumber,
  "Math.acosh": unaryNumber,
  "Math.asin": unaryNumber,
  "Math.asinh": unaryNumber,
  "Math.atan": unaryNumber,
  "Math.atanh": unaryNumber,
  "Math.atan2": binaryNumber,
  "Math.cbrt": unaryNumber,
  "Math.ceil": unaryNumber,
  "Math.clz32": unaryNumber,
  "Math.cos": unaryNumber,
  "Math.cosh": unaryNumber,
  "Math.exp": unaryNumber,
  "Math.expm1": unaryNumber,
  "Math.floor": unaryNumber,
  "Math.fround": unaryNumber,
  "Math.hypot": variadicNumber,
  "Math.imul": binaryNumber,
  "Math.log": unaryNumber,
  "Math.log1p": unaryNumber,
  "Math.log10": unaryNumber,
  "Math.log2": unaryNumber,
  "Math.max": variadicNumber,
  "Math.min": variadicNumber,
  "Math.pow": binaryNumber,
  "Math.round": unaryNumber,
  "Math.sign": unaryNumber,
  "Math.sin": unaryNumber,
  "Math.sinh": unaryNumber,
  "Math.sqrt": unaryNumber,
  "Math.tan": unaryNumber,
  "Math.tanh": unaryNumber,
  "Math.trunc": unaryNumber,
};

export const CustomSummaries: { [string]: CustomSummary } = {
  "Array.prototype.indexOf": (realm, context, args) => arraySearch(realm, context, args, "indexOf"),
  "Array.prototype.lastIndexOf": (realm, context, args) => arraySearch(realm, context, args, "lastIndexOf"),
  "Array.prototype.includes": (realm, context, args) => arraySearch(realm, context, args, "includes"),
  "Array.prototype.join": arrayJoin,
  "RegExp.prototype.test": (realm, context, args) => regExpCall(realm, context, args, "test"),
  "RegExp.prototype.exec": (realm, context, args) => regExpCall(realm, context, args, "exec"),
  "String.prototype.replace": stringRegExpCall,
  "String.prototype.search": stringRegExpCall,
  "String.prototype.match": stringRegExpCall,
};

export function installBuiltinSummaries(i: Intrinsics, realm: Realm): void {
  if (!realm.useAbstractInterpretation) return;
  for (let name of Object.keys(BuiltinSummaries)) {
    let func = lookupIntrinsic(i, name);
    if (func === undefined) continue; // not available in this compatibility mode
    let summary = BuiltinSummaries[name];
    func.summary = (context, args) => applyBuiltinSummary(realm, name, summary, context, args);
  }
  for (let name of Object.keys(CustomSummaries)) {
    let func = lookupIntrinsic(i, name);
    if (func === undefined) continue;
    let summary = CustomSummaries[name];
    func.summary = (context, args) => summary(realm, context, args, func);
  }
}

function lookupIntrinsic(i: Intrinsics, name: string): void | NativeFunctionValue {
  let [root, ...path] = name.split(".");
  let value = (i: any)[root];
  for (let key of path) {
    if (!(value instanceof ObjectValue)) return undefined;
    value = value._SafeGetDataPropertyValue(key);
  }
  if (!(value instanceof NativeFunctionValue)) return undefined;
  invariant(value.intrinsicName === name, `summary ${name} attached to ${value.intrinsicName || "?"}`);
  return value;
}

function applyBuiltinSummary(
  realm: Realm,
  name: string,
  summary: BuiltinSummary,
  context: Value,
  args: Array<Value>
): void | Value {
  let receiver = summary.receiver || "ignored";
  let inputs = receiver === "ignored" ? args : [context, ...args];
  if (!inputs.some(isUnknown)) return undefined;
  if (inputs.length > Placeholders.length) return undefined;
  if (summary.applies !== undefined && !summary.applies(args)) return undefined;

  let classifications = args.map((arg, index) => classify(arg, getArgKind(summary, index)));
  if (receiver !== "ignored") classifications.unshift(classifyReceiver(context, receiver));
  if (classifications.indexOf("bail") >= 0) return undefined;

  let resultType = summary.resultType !== undefined ? summary.resultType(args) : summary.result;
  let params = Placeholders.slice(0, inputs.length);
  let templateSource;
  if (receiver === "ignored") {
    templateSource = `global.${name}(${params.join(", ")})`;
  } else {
    let method = name.substr(name.lastIndexOf(".") + 1);
    // Only a receiver of the matching primitive type is guaranteed to find the built-in by property lookup.
    let isMatchingPrimitive =
      receiver === "string"
        ? context instanceof StringValue || (context instanceof AbstractValue && context.getType() === StringValue)
        : context instanceof AbstractValue && isNumberType(context.getType());
    templateSource = isMatchingPrimitive
      ? `A.${method}(${params.slice(1).join(", ")})`
      : `global.${name}.call(${params.join(", ")})`;
  }

  let mayThrow = summary.mayThrow !== undefined && summary.mayThrow(args);
  return residualize(realm, templateSource, resultType, inputs, classifications, mayThrow);
}

// An abstract value, or a leaked object whose properties are no longer known.
function isUnknown(value: Value): boolean {
  return value instanceof AbstractValue || (value instanceof ObjectValue && value.mightBeLeakedObject());
}

function getArgKind(summary: BuiltinSummary, index: number): InputKind {
  if (index < summary.args.length) return summary.args[index];
  return summary.rest || "none";
}

// Builds the residual value: pure if no input can throw or run user code, otherwise (pure scope only)
// a temporal value that may throw, leaking inputs whose coercion runs user code.
function residualize(
  realm: Realm,
  templateSource: string,
  resultType: typeof Value,
  inputs: Array<Value>,
  classifications: Array<Classification>,
  mayThrow: boolean
): void | Value {
  invariant(classifications.length === inputs.length);
  if (!mayThrow && classifications.every(c => c === "pure")) {
    let value = AbstractValue.createFromTemplate(realm, templateSource, resultType, inputs);
    // A value whose type is only known under a path condition is temporal; keep the call after the
    // point where that condition holds (see #2327).
    return AbstractValue.convertToTemporalIfArgsAreTemporal(realm, value, inputs);
  }
  if (!realm.isInPureScope() || realm.instantRender.enabled) return undefined;
  return realm.evaluateWithPossibleThrowCompletion(
    () => {
      inputs.forEach((input, index) => {
        if (classifications[index] === "user") Leak.value(realm, input);
      });
      return AbstractValue.createTemporalFromTemplate(realm, templateSource, resultType, inputs);
    },
    TypesDomain.topVal,
    ValuesDomain.topVal
  );
}

function isNumberType(type: typeof Value): boolean {
  return isTypeOrSubtype(type, NumberValue);
}

function isTypeOrSubtype(type: typeof Value, expected: typeof Value): boolean {
  return Value.isTypeCompatibleWith(type, expected);
}

function classify(value: Value, kind: InputKind): Classification {
  if (kind === "none") return "pure";
  if (value instanceof ConcreteValue) {
    // Concrete objects and symbols are left to the native implementation, which can evaluate
    // their coercions (or throw) precisely, unless the object has leaked and its properties are unknown.
    if (value instanceof ObjectValue) return value.mightBeLeakedObject() ? "user" : "bail";
    if (value instanceof SymbolValue) return kind === "string-or-symbol" || kind === "json" ? "pure" : "bail";
    return "pure";
  }
  invariant(value instanceof AbstractValue);
  if (value.mightBeObject()) return "user";
  let type = value.getType();
  // PrimitiveValue (an unknown primitive) might be a symbol.
  if (type === SymbolValue || type === PrimitiveValue || !isTypeOrSubtype(type, PrimitiveValue)) {
    return kind === "string-or-symbol" || kind === "json" ? "pure" : "throws";
  }
  return "pure";
}

function classifyReceiver(context: Value, kind: ReceiverKind): Classification {
  if (kind === "number") {
    if (context instanceof NumberValue) return "pure";
    if (context instanceof AbstractValue && isNumberType(context.getType())) return "pure";
    return "bail";
  }
  invariant(kind === "string");
  if (context instanceof ConcreteValue) {
    if (context instanceof UndefinedValue || context instanceof NullValue) return "bail";
    return classify(context, "string");
  }
  invariant(context instanceof AbstractValue);
  if (context.mightBeObject()) return "user";
  let type = context.getType();
  if (type === StringValue || type === BooleanValue || isNumberType(type)) return "pure";
  // Might be null, undefined or a symbol: RequireObjectCoercible/ToString throw.
  return "throws";
}

// The elements of a concrete array whose reads cannot run user code: an ordinary, unleaked
// array with a known length, inheriting from %ArrayPrototype%, and without holes or accessors
// (holes would read %ArrayPrototype% and %ObjectPrototype%, which we assume are unmodified, but
// we keep it simple).
function getPlainArrayElements(realm: Realm, array: Value, maxLength: number): void | Array<Value> {
  if (!(array instanceof ArrayValue)) return undefined;
  if (array.$Prototype !== realm.intrinsics.ArrayPrototype) return undefined;
  if (array.isIntrinsic() || array.isPartialObject() || array.mightBeLeakedObject()) return undefined;
  if (array.unknownProperty !== undefined) return undefined;
  let length = getOwnDataValue(array, "length");
  if (!(length instanceof NumberValue) || length.value > maxLength) return undefined;
  let elements = [];
  for (let k = 0; k < length.value; k++) {
    let element = getOwnDataValue(array, k + "");
    if (element === undefined) return undefined;
    elements.push(element);
  }
  return elements;
}

function getOwnDataValue(object: ObjectValue, key: string): void | Value {
  let binding = object.properties.get(key);
  if (binding === undefined) return undefined;
  let descriptor = binding.descriptor;
  if (!(descriptor instanceof PropertyDescriptor)) return undefined;
  let value = descriptor.value;
  if (!(value instanceof Value) || value instanceof EmptyValue) return undefined;
  if (value instanceof AbstractValue && value.mightHaveBeenDeleted()) return undefined;
  return value;
}

const MaxSearchChain = 32;

// ECMA262 22.1.3.11 / 22.1.3.14 / 22.1.3.17 (ES2016) on a concrete array: elements are compared
// with Strict Equality (indexOf, lastIndexOf) or SameValueZero (includes). Neither runs user code,
// so the result is a pure conditional expression over the elements.
function arraySearch(
  realm: Realm,
  context: Value,
  args: Array<Value>,
  method: "indexOf" | "lastIndexOf" | "includes"
): void | Value {
  let elements = getPlainArrayElements(realm, context, MaxSearchChain);
  if (elements === undefined) return undefined;
  let searchElement = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  if (!(searchElement instanceof AbstractValue) && !elements.some(e => e instanceof AbstractValue)) return undefined;
  let len = elements.length;

  // fromIndex: only absent, undefined or concrete numbers (ToInteger on those cannot run user code).
  let fromIndex = args.length > 1 ? args[1] : realm.intrinsics.undefined;
  let n;
  if (fromIndex instanceof UndefinedValue) n = method === "lastIndexOf" && args.length < 2 ? len - 1 : 0;
  else if (fromIndex instanceof NumberValue) n = isNaN(fromIndex.value) ? 0 : Math.trunc(fromIndex.value);
  else return undefined;
  // For lastIndexOf, an explicit undefined is ToInteger(undefined) = 0.

  let indices = [];
  if (method === "lastIndexOf") {
    let k = n >= 0 ? Math.min(n, len - 1) : len + n;
    for (; k >= 0; k--) indices.push(k);
  } else {
    let k = n >= 0 ? n : Math.max(len + n, 0);
    for (; k < len; k++) indices.push(k);
  }

  if (method === "includes") {
    let result = realm.intrinsics.false;
    for (let k of indices.reverse()) {
      result = or(realm, sameValueZero(realm, searchElement, elements[k]), result);
    }
    return result;
  }
  let result = new NumberValue(realm, -1);
  for (let k of indices.reverse()) {
    let same = strictEquals(realm, searchElement, elements[k]);
    if (same instanceof BooleanValue) {
      if (same.value) result = new NumberValue(realm, k);
      continue;
    }
    result = AbstractValue.createFromConditionalOp(realm, same, new NumberValue(realm, k), result);
  }
  return result;
}

function strictEquals(realm: Realm, x: Value, y: Value): Value {
  if (x instanceof ConcreteValue && y instanceof ConcreteValue) {
    return new BooleanValue(realm, StrictEqualityComparison(realm, x, y));
  }
  return AbstractValue.createFromBinaryOp(realm, "===", x, y);
}

function sameValueZero(realm: Realm, x: Value, y: Value): Value {
  let isNaNValue = v => v instanceof NumberValue && isNaN(v.value);
  if (isNaNValue(x)) return y instanceof ConcreteValue ? realm.intrinsics.false : notSelf(realm, y);
  if (isNaNValue(y)) return x instanceof ConcreteValue ? realm.intrinsics.false : notSelf(realm, x);
  if (x instanceof ConcreteValue || y instanceof ConcreteValue) return strictEquals(realm, x, y);
  // Both abstract: x === y || (x !== x && y !== y).
  return or(realm, strictEquals(realm, x, y), and(realm, notSelf(realm, x), notSelf(realm, y)));
}

function notSelf(realm: Realm, x: Value): Value {
  if (x instanceof ConcreteValue) return new BooleanValue(realm, x instanceof NumberValue && isNaN(x.value));
  return AbstractValue.createFromBinaryOp(realm, "!==", x, x);
}

function or(realm: Realm, x: Value, y: Value): Value {
  if (x instanceof BooleanValue) return x.value ? x : y;
  if (y instanceof BooleanValue && !y.value) return x;
  return AbstractValue.createFromLogicalOp(realm, "||", x, y);
}

function and(realm: Realm, x: Value, y: Value): Value {
  if (x instanceof BooleanValue) return x.value ? y : x;
  if (y instanceof BooleanValue && y.value) return x;
  return AbstractValue.createFromLogicalOp(realm, "&&", x, y);
}

// ECMA262 22.1.3.13 on a concrete array: ToString(separator) (default ","), then each element is
// converted with ToString, except that undefined and null become the empty string.
function arrayJoin(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let elements = getPlainArrayElements(realm, context, Placeholders.length - 1);
  if (elements === undefined) return undefined;
  let separator = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  if (!(separator instanceof AbstractValue) && !elements.some(e => e instanceof AbstractValue)) return undefined;

  // If the separator is known and every element's string form is known to be `"" + element`,
  // build the concatenation directly so that it can be simplified further.
  if (separator instanceof StringValue || separator instanceof UndefinedValue) {
    let sep = separator instanceof StringValue ? separator.value : ",";
    let pieces = elements.map(e => joinPiece(realm, e));
    if (pieces.every(p => p !== undefined)) {
      let result: Value = realm.intrinsics.emptyString;
      pieces.forEach((piece, k) => {
        invariant(piece !== undefined);
        if (k > 0) result = concat(realm, result, new StringValue(realm, sep));
        result = concat(realm, result, piece);
      });
      return result;
    }
  }

  // Otherwise residualize the call on a fresh array literal holding the same elements.
  let classifications = elements.map(e => classifyJoinElement(e));
  classifications.push(classify(separator, "string"));
  if (classifications.indexOf("bail") >= 0) return undefined;
  let params = Placeholders.slice(0, elements.length + 1);
  let separatorParam = params.pop();
  let templateSource = `[${params.join(", ")}].join(${args.length > 0 ? separatorParam : ""})`;
  let inputs = args.length > 0 ? [...elements, separator] : elements;
  if (args.length === 0) classifications.pop();
  return residualize(realm, templateSource, StringValue, inputs, classifications, false);
}

function classifyJoinElement(element: Value): Classification {
  if (element instanceof UndefinedValue || element instanceof NullValue) return "pure";
  return classify(element, "string");
}

// The string an element contributes to join, when that is `"" + element` (or a known string).
function joinPiece(realm: Realm, element: Value): void | Value {
  if (element instanceof UndefinedValue || element instanceof NullValue) return realm.intrinsics.emptyString;
  if (element instanceof StringValue) return element;
  if (element instanceof NumberValue || element instanceof BooleanValue)
    return new StringValue(realm, element.value + "");
  if (!(element instanceof AbstractValue)) return undefined;
  let type = element.getType();
  if (type === StringValue) return element;
  if (type === BooleanValue || isNumberType(type)) {
    return AbstractValue.createFromBinaryOp(realm, "+", realm.intrinsics.emptyString, element);
  }
  return undefined;
}

function concat(realm: Realm, x: Value, y: Value): Value {
  if (x instanceof StringValue && y instanceof StringValue) return new StringValue(realm, x.value + y.value);
  if (x instanceof StringValue && x.value === "") return y;
  if (y instanceof StringValue && y.value === "") return x;
  return AbstractValue.createFromBinaryOp(realm, "+", x, y);
}

// A concrete RegExp whose matching only depends on its source and flags: an unleaked ordinary
// RegExp instance inheriting from %RegExpPrototype% whose only own property is a writable
// lastIndex holding +0, and without the sticky flag. For such a RegExp, test/exec (without g),
// search, and replace/match (with or without g) leave lastIndex at +0, so the call can be
// residualized on a fresh, equivalent RegExp literal without mutating the original.
function getSimpleRegExpLiteral(realm: Realm, R: Value, allowGlobal: boolean): void | string {
  if (!(R instanceof ObjectValue) || R instanceof AbstractValue) return undefined;
  let source = R.$OriginalSource;
  let flags = R.$OriginalFlags;
  if (typeof source !== "string" || typeof flags !== "string" || R.$RegExpMatcher === undefined) return undefined;
  if (flags.indexOf("y") >= 0 || (!allowGlobal && flags.indexOf("g") >= 0)) return undefined;
  if (R.$Prototype !== realm.intrinsics.RegExpPrototype) return undefined;
  if (R.isPartialObject() || R.mightBeLeakedObject() || R.unknownProperty !== undefined) return undefined;
  if (R.symbols.size > 0) return undefined;
  for (let [key, binding] of R.properties) {
    if (binding.descriptor === undefined) continue;
    if (key !== "lastIndex") return undefined;
  }
  let lastIndexBinding = R.properties.get("lastIndex");
  if (lastIndexBinding === undefined) return undefined;
  let descriptor = lastIndexBinding.descriptor;
  if (!(descriptor instanceof PropertyDescriptor) || descriptor.writable !== true) return undefined;
  let lastIndex = descriptor.value;
  if (!(lastIndex instanceof NumberValue) || lastIndex.value !== 0 || 1 / lastIndex.value < 0) return undefined;
  // Node's own printer escapes "/" and line terminators (ECMA262 21.2.3.2.4).
  let literal = new RegExp(source, flags).toString();
  // The template engine treats "global" and single capital letters as placeholders.
  if (literal.indexOf("global") >= 0) return undefined;
  return literal;
}

// ECMA262 21.2.5.13 RegExp.prototype.test / 21.2.5.2 RegExp.prototype.exec with an abstract string.
function regExpCall(realm: Realm, context: Value, args: Array<Value>, method: "test" | "exec"): void | Value {
  let S = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  if (!(S instanceof AbstractValue)) return undefined;
  let literal = getSimpleRegExpLiteral(realm, context, false);
  if (literal === undefined) return undefined;
  let classification = classify(S, "string");
  if (classification === "bail") return undefined;
  let templateSource = `${literal}.${method}(A)`;
  if (method === "test") return residualize(realm, templateSource, BooleanValue, [S], [classification], false);
  // exec returns a fresh array (or null) on every call, so the result is temporal.
  if (!realm.isInPureScope() || realm.instantRender.enabled) return undefined;
  if (classification === "pure") {
    return AbstractValue.createTemporalFromTemplate(realm, templateSource, Value, [S], { isPure: true });
  }
  return residualize(realm, templateSource, Value, [S], [classification], true);
}

// ECMA262 21.1.3.14 / 21.1.3.15 / 21.1.3.11: replace(regexp, string), search(regexp), match(regexp)
// on an abstract string, with a simple concrete RegExp and (for replace) a concrete replacement string.
// A function replacement would run user code with match results and is left to the native implementation.
function stringRegExpCall(realm: Realm, context: Value, args: Array<Value>, func: NativeFunctionValue): void | Value {
  if (!(context instanceof AbstractValue)) return undefined;
  let method = func.name;
  let literal = getSimpleRegExpLiteral(realm, args[0], method !== "search");
  if (literal === undefined) return undefined;
  let receiverClassification = classifyReceiver(context, "string");
  let inputs = [context];
  let classifications = [receiverClassification];
  let templateSource;
  if (method === "replace") {
    if (args.length < 2 || !(args[1] instanceof StringValue)) return undefined;
    inputs.push(args[1]);
    classifications.push("pure");
    templateSource = `global.String.prototype.replace.call(A, ${literal}, B)`;
  } else {
    templateSource = `global.String.prototype.${method}.call(A, ${literal})`;
  }
  if (receiverClassification === "pure" && context.getType() === StringValue) {
    templateSource = method === "replace" ? `A.replace(${literal}, B)` : `A.${method}(${literal})`;
  }
  if (method === "match") {
    // A fresh array (or null) on every call.
    if (!realm.isInPureScope() || realm.instantRender.enabled) return undefined;
    if (receiverClassification === "pure") {
      return AbstractValue.createTemporalFromTemplate(realm, templateSource, Value, inputs, { isPure: true });
    }
    return residualize(realm, templateSource, Value, inputs, classifications, true);
  }
  let resultType = method === "replace" ? StringValue : NumberValue;
  return residualize(realm, templateSource, resultType, inputs, classifications, false);
}
