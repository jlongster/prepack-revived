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
 * Summaries only engage when at least one consumed input is abstract (or a leaked object), so
 * concrete calls are still evaluated by the native implementation.
 */

import type { Realm } from "../realm.js";
import type { Intrinsics } from "../types.js";
import {
  AbstractObjectValue,
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
  ProxyValue,
  StringValue,
  SymbolValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { TypesDomain, ValuesDomain } from "../domains/index.js";
import { Leak, To } from "../singletons.js";
import { PropertyDescriptor } from "../descriptors.js";
import { StrictEqualityComparison } from "../methods/abstract.js";
import { EnumerableOwnProperties, IsCallable } from "../methods/index.js";
import { createOperationDescriptor } from "../utils/generator.js";
import { Placeholders } from "../utils/PreludeGenerator.js";
import invariant from "../invariant.js";

// How a built-in consumes an input.
// - "number": ToNumber and friends (ToInteger, ToInt32, ToUint32, ToLength). Objects run user code, symbols throw.
// - "string": ToString. Objects run user code, symbols throw.
// - "string-or-symbol": like "string" but symbols are fine (String(sym) and ToPropertyKey(sym) do not throw).
// - "json": JSON.stringify's value. Primitives are fine (symbols give undefined), objects run user code (toJSON, getters, proxies).
// - "none": the value is not read at all, coerced with ToBoolean, or only compared by identity.
type InputKind = "number" | "string" | "string-or-symbol" | "json" | "none";

// How a built-in consumes its receiver.
// - "ignored": the receiver is not used (static functions).
// - "string": RequireObjectCoercible(this) then ToString(this).
// - "string-value": thisStringValue(this). Only primitive strings are summarized.
// - "number": thisNumberValue(this). Only primitive numbers are summarized.
// - "boolean": thisBooleanValue(this). Only primitive booleans are summarized.
// - "to-string-tag": Object.prototype.toString(this). Primitives are pure; objects may read @@toStringTag.
type ReceiverKind = "ignored" | "string" | "string-value" | "number" | "boolean" | "to-string-tag";

type Classification = "pure" | "throws" | "user" | "bail";

export type BuiltinSummary = {|
  receiver?: ReceiverKind,
  args: Array<InputKind>,
  // How arguments beyond `args` are consumed. They are ignored ("none") by most built-ins.
  rest?: InputKind,
  result: typeof Value,
  // Whether the built-in might throw for some primitive inputs (e.g. a RangeError for a bad radix).
  // Gets the consumed argument list.
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

function isValidCodePoint(arg: Value): boolean {
  return (
    arg instanceof NumberValue &&
    isFinite(arg.value) &&
    Math.floor(arg.value) === arg.value &&
    arg.value >= 0 &&
    arg.value <= 0x10ffff
  );
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

  // ECMA262 19.1.3.6: primitives are pure; objects may read @@toStringTag or throw on revoked proxies.
  "Object.prototype.toString": { receiver: "to-string-tag", args: [], rest: "none", result: StringValue },

  // ECMA262 19.3.1.1 called as a function: ToBoolean(value), which never throws or runs user code.
  Boolean: {
    args: ["none"],
    rest: "none",
    result: BooleanValue,
    applies: args => args.length > 0 && args[0].mightBeTrue() && args[0].mightBeFalse(),
  },
  "Boolean.prototype.toString": { receiver: "boolean", args: [], rest: "none", result: StringValue },
  "Boolean.prototype.valueOf": { receiver: "boolean", args: [], rest: "none", result: BooleanValue },

  // ECMA262 20.1.1.1 called as a function: ToNumber(value) (+0 when absent).
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
  // ECMA262 20.1.3.6: RangeError for radix outside 2..36 unless undefined (absent/undefined is handled natively).
  "Number.prototype.toString": {
    receiver: "number",
    args: ["number"],
    rest: "none",
    result: StringValue,
    applies: args => args.length > 0 && !(args[0] instanceof UndefinedValue),
    mayThrow: concreteIntegerIn(2, 36),
  },
  "Number.prototype.valueOf": { receiver: "number", args: [], rest: "none", result: NumberValue },

  // ECMA262 21.1.1.1 called as a function: SymbolDescriptiveString for symbols, else ToString ("" when absent).
  // Known StringValues already fold to themselves in String.js.
  String: {
    args: ["string-or-symbol"],
    rest: "none",
    result: StringValue,
    applies: args => args.length > 0 && args[0].getType() !== StringValue,
  },
  // ECMA262 21.1.2.1: ToUint16(ToNumber(each)).
  "String.fromCharCode": { args: [], rest: "number", result: StringValue },
  // ECMA262 21.1.2.2: ToNumber(each), RangeError unless integer in 0..0x10FFFF.
  "String.fromCodePoint": {
    args: [],
    rest: "number",
    result: StringValue,
    mayThrow: args => !args.every(isValidCodePoint),
  },
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
  "String.prototype.valueOf": { receiver: "string-value", args: [], rest: "none", result: StringValue },

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
  "Object.is": objectIs,
  "Object.prototype.hasOwnProperty": objectHasOwnProperty,
  "Array.isArray": arrayIsArray,
  "Array.prototype.indexOf": (realm, context, args) => arraySearch(realm, context, args, "indexOf"),
  "Array.prototype.lastIndexOf": (realm, context, args) => arraySearch(realm, context, args, "lastIndexOf"),
  "Array.prototype.includes": (realm, context, args) => arraySearch(realm, context, args, "includes"),
  "Array.prototype.join": arrayJoin,
  "Array.prototype.slice": arraySlice,
  "JSON.stringify": jsonStringify,
  "RegExp.prototype.test": (realm, context, args) => regExpCall(realm, context, args, "test"),
  "RegExp.prototype.exec": (realm, context, args) => regExpCall(realm, context, args, "exec"),
  "String.prototype.indexOf": (realm, context, args) =>
    foldConcatSearch(realm, context, args, "indexOf") ||
    applyBuiltinSummary(realm, "String.prototype.indexOf", BuiltinSummaries["String.prototype.indexOf"], context, args),
  "String.prototype.includes": (realm, context, args) =>
    foldConcatSearch(realm, context, args, "includes") ||
    applyBuiltinSummary(
      realm,
      "String.prototype.includes",
      BuiltinSummaries["String.prototype.includes"],
      context,
      args
    ),
  "String.prototype.startsWith": (realm, context, args) =>
    foldConcatSearch(realm, context, args, "startsWith") ||
    applyBuiltinSummary(
      realm,
      "String.prototype.startsWith",
      BuiltinSummaries["String.prototype.startsWith"],
      context,
      args
    ),
  "String.prototype.endsWith": (realm, context, args) =>
    foldConcatSearch(realm, context, args, "endsWith") ||
    applyBuiltinSummary(
      realm,
      "String.prototype.endsWith",
      BuiltinSummaries["String.prototype.endsWith"],
      context,
      args
    ),
  "String.prototype.replace": stringReplace,
  "String.prototype.search": stringRegExpCall,
  "String.prototype.match": stringRegExpCall,
  "String.prototype.split": stringSplit,
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
  let consumedArgs = summary.rest === "none" ? args.slice(0, summary.args.length) : args;
  let inputs = receiver === "ignored" ? consumedArgs : [context, ...consumedArgs];
  if (!inputs.some(isUnknown)) return undefined;
  if (inputs.length > Placeholders.length) return undefined;
  if (summary.applies !== undefined && !summary.applies(consumedArgs)) return undefined;

  let classifications = consumedArgs.map((arg, index) => classify(realm, arg, getArgKind(summary, index)));
  if (receiver !== "ignored") classifications.unshift(classifyReceiver(realm, context, receiver));
  if (classifications.indexOf("bail") >= 0) return undefined;

  let resultType = summary.resultType !== undefined ? summary.resultType(consumedArgs) : summary.result;
  let params = Placeholders.slice(0, inputs.length);
  let templateSource;
  if (receiver === "ignored") {
    templateSource = `global.${name}(${params.join(", ")})`;
  } else {
    let method = name.substr(name.lastIndexOf(".") + 1);
    // Only a receiver of the matching primitive type is guaranteed to find the built-in by property lookup.
    let isMatchingPrimitive = false;
    if (receiver === "string" || receiver === "string-value") {
      isMatchingPrimitive =
        context instanceof StringValue || (context instanceof AbstractValue && context.getType() === StringValue);
    } else if (receiver === "number") {
      isMatchingPrimitive = context instanceof AbstractValue && isNumberType(context.getType());
    } else if (receiver === "boolean") {
      isMatchingPrimitive = context instanceof AbstractValue && context.getType() === BooleanValue;
    }
    templateSource = isMatchingPrimitive
      ? `A.${method}(${params.slice(1).join(", ")})`
      : `global.${name}.call(${params.join(", ")})`;
  }

  let mayThrow = summary.mayThrow !== undefined && summary.mayThrow(consumedArgs);
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

// True when `value` is an abstract object marked simple (e.g. via `__makeSimple`) whose elements all
// inherit from %ObjectPrototype%, have no symbols, and define no own `valueOf` or `toString` property
// (see #1682: concrete `{ valueOf() {...} }` satisfies `ObjectValue.isSimpleObject()`, so we check explicitly).
function isCoercionPureSimpleObject(realm: Realm, value: Value): boolean {
  if (!(value instanceof AbstractObjectValue) || value.values.isTop() || !value.isSimpleObject()) return false;
  for (let elem of value.values.getElements()) {
    if (!(elem instanceof ObjectValue) || elem instanceof ArrayValue || elem instanceof ProxyValue) return false;
    if (elem.$Prototype !== realm.intrinsics.ObjectPrototype) return false;
    if (elem.symbols.size > 0 || elem.mightBeLeakedObject()) return false;
    if (elem.properties.has("valueOf") || elem.properties.has("toString") || elem.properties.has("toJSON"))
      return false;
  }
  return true;
}

function classify(realm: Realm, value: Value, kind: InputKind): Classification {
  if (kind === "none") return "pure";
  if (value instanceof ConcreteValue) {
    // Concrete objects and symbols are left to the native implementation, which can evaluate
    // their coercions (or throw) precisely, unless the object has leaked and its properties are unknown.
    if (value instanceof ObjectValue) return value.mightBeLeakedObject() ? "user" : "bail";
    if (value instanceof SymbolValue) return kind === "string-or-symbol" || kind === "json" ? "pure" : "bail";
    return "pure";
  }
  invariant(value instanceof AbstractValue);
  if (value.mightBeObject()) {
    return isCoercionPureSimpleObject(realm, value) ? "pure" : "user";
  }
  let type = value.getType();
  // PrimitiveValue (an unknown primitive) might be a symbol.
  if (type === SymbolValue || type === PrimitiveValue || !isTypeOrSubtype(type, PrimitiveValue)) {
    return kind === "string-or-symbol" || kind === "json" ? "pure" : "throws";
  }
  return "pure";
}

function classifyReceiver(realm: Realm, context: Value, kind: ReceiverKind): Classification {
  if (kind === "number") {
    if (context instanceof NumberValue) return "pure";
    if (context instanceof AbstractValue && isNumberType(context.getType())) return "pure";
    return "bail";
  }
  if (kind === "boolean") {
    if (context instanceof BooleanValue) return "pure";
    if (context instanceof AbstractValue && context.getType() === BooleanValue) return "pure";
    return "bail";
  }
  if (kind === "string-value") {
    if (context instanceof StringValue) return "pure";
    if (context instanceof AbstractValue && context.getType() === StringValue) return "pure";
    return "bail";
  }
  if (kind === "to-string-tag") {
    if (context instanceof ConcreteValue) {
      return context instanceof ObjectValue && context.mightBeLeakedObject() ? "user" : "bail";
    }
    invariant(context instanceof AbstractValue);
    if (!context.mightBeObject() || isCoercionPureSimpleObject(realm, context)) return "pure";
    return "user";
  }
  invariant(kind === "string");
  if (context instanceof ConcreteValue) {
    if (context instanceof UndefinedValue || context instanceof NullValue) return "bail";
    return classify(realm, context, "string");
  }
  invariant(context instanceof AbstractValue);
  if (context.mightBeObject()) {
    return isCoercionPureSimpleObject(realm, context) ? "pure" : "user";
  }
  let type = context.getType();
  if (type === StringValue || type === BooleanValue || isNumberType(type)) return "pure";
  // Might be null, undefined or a symbol: RequireObjectCoercible/ToString throw.
  return "throws";
}

// Classifies an abstract array-like receiver for read-only indexed methods (`indexOf`, `slice`, `join`).
function classifyArrayLikeReceiver(realm: Realm, context: Value): Classification {
  if (context instanceof ConcreteValue) {
    return context instanceof ObjectValue && context.mightBeLeakedObject() ? "user" : "bail";
  }
  invariant(context instanceof AbstractValue);
  if (context.mightBeObject()) {
    return isCoercionPureSimpleObject(realm, context) ? "pure" : "user";
  }
  let type = context.getType();
  if (type === StringValue || type === BooleanValue || type === SymbolValue || isNumberType(type)) return "pure";
  return "throws";
}

// ECMA262 19.1.2.10 Object.is(value1, value2): SameValue never throws or invokes user code.
function objectIs(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let x = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  let y = args.length > 1 ? args[1] : realm.intrinsics.undefined;
  if (!(x instanceof AbstractValue) && !(y instanceof AbstractValue)) return undefined;
  let tx = x.getType();
  let ty = y.getType();
  if (tx !== Value && ty !== Value && !isTypeOrSubtype(tx, ty) && !isTypeOrSubtype(ty, tx)) {
    return realm.intrinsics.false;
  }
  if (tx === UndefinedValue && ty === UndefinedValue) return realm.intrinsics.true;
  if (tx === NullValue && ty === NullValue) return realm.intrinsics.true;
  return residualize(realm, "global.Object.is(A, B)", BooleanValue, [x, y], ["pure", "pure"], false);
}

// ECMA262 19.1.3.2 Object.prototype.hasOwnProperty(V): ToPropertyKey(V), ToObject(this), HasOwnProperty(O, P).
function objectHasOwnProperty(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let key = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  if (!isUnknown(context) && !isUnknown(key)) return undefined;

  // Snapshot lookup on a known plain object with an abstract string key: `key === "a" || key === "b"`.
  if (
    context instanceof ObjectValue &&
    !(context instanceof ProxyValue) &&
    !context.isPartialObject() &&
    !context.mightBeLeakedObject() &&
    context.unknownProperty === undefined &&
    key instanceof AbstractValue &&
    key.getType() === StringValue &&
    context.properties.size <= MaxSearchChain
  ) {
    let ownKeys = [];
    let allConcrete = true;
    for (let [name, binding] of context.properties) {
      if (binding.descriptor === undefined) continue;
      if (!(binding.descriptor instanceof PropertyDescriptor)) {
        allConcrete = false;
        break;
      }
      let val = binding.descriptor.value;
      if (val instanceof EmptyValue) continue;
      if (val instanceof AbstractValue && val.mightHaveBeenDeleted()) {
        allConcrete = false;
        break;
      }
      ownKeys.push(name);
    }
    if (allConcrete) {
      let result: Value = realm.intrinsics.false;
      for (let i = ownKeys.length - 1; i >= 0; i--) {
        result = or(realm, strictEquals(realm, key, new StringValue(realm, ownKeys[i])), result);
      }
      return AbstractValue.convertToTemporalIfArgsAreTemporal(
        realm,
        result instanceof AbstractValue ? result : result,
        [key]
      );
    }
  }

  let keyClass = classify(realm, key, "string-or-symbol");
  if (keyClass === "bail") keyClass = "pure";
  let receiverClass: Classification;
  if (context instanceof UndefinedValue || context instanceof NullValue) {
    return undefined;
  } else if (context instanceof ConcreteValue) {
    receiverClass = context instanceof ObjectValue ? "user" : "pure";
  } else {
    invariant(context instanceof AbstractValue);
    if (context.mightBeObject()) {
      receiverClass = isCoercionPureSimpleObject(realm, context) ? "pure" : "user";
    } else {
      let type = context.getType();
      receiverClass =
        type === StringValue || type === BooleanValue || type === SymbolValue || isNumberType(type) ? "pure" : "throws";
    }
  }
  return residualize(
    realm,
    "global.Object.prototype.hasOwnProperty.call(A, B)",
    BooleanValue,
    [context, key],
    [receiverClass, keyClass],
    false
  );
}

// ECMA262 22.1.2.2 Array.isArray(arg): inspects internal slots only; throws TypeError only on revoked proxies.
function arrayIsArray(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let arg = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  if (!(arg instanceof AbstractValue) || !arg.mightBeObject()) return undefined;
  if (arg instanceof AbstractObjectValue && !arg.values.isTop()) {
    let elements = Array.from(arg.values.getElements());
    if (elements.length > 0 && elements.every(e => e instanceof ArrayValue)) {
      return realm.intrinsics.true;
    }
    if (arg.isSimpleObject() && elements.every(e => !(e instanceof ArrayValue) && !(e instanceof ProxyValue))) {
      return undefined;
    }
  }
  let classification: Classification = isCoercionPureSimpleObject(realm, arg) ? "pure" : "throws";
  return residualize(realm, "global.Array.isArray(A)", BooleanValue, [arg], [classification], false);
}

// Folds `(prefix + rest).indexOf/startsWith/includes` and `(init + suffix).endsWith/includes` when the
// concrete prefix/suffix already determines the answer and the other operand's ToString is pure.
function foldConcatSearch(
  realm: Realm,
  context: Value,
  args: Array<Value>,
  method: "indexOf" | "includes" | "startsWith" | "endsWith"
): void | Value {
  if (!(context instanceof AbstractValue) || context.getType() !== StringValue || context.kind !== "+")
    return undefined;
  if (args.length === 0 || !(args[0] instanceof StringValue)) return undefined;
  if (args.length > 1 && !(args[1] instanceof UndefinedValue)) return undefined;
  let needle = args[0].value;
  let [left, right] = context.args;
  if (left instanceof StringValue && To.IsToStringPure(realm, right) && !right.isTemporal()) {
    let prefix = left.value;
    if (method === "indexOf") {
      let idx = prefix.indexOf(needle);
      if (idx >= 0) return new NumberValue(realm, idx);
    } else if (method === "includes") {
      if (prefix.indexOf(needle) >= 0) return realm.intrinsics.true;
    } else if (method === "startsWith") {
      if (prefix.length >= needle.length) return new BooleanValue(realm, prefix.startsWith(needle));
      if (!needle.startsWith(prefix)) return realm.intrinsics.false;
    }
  }
  if (right instanceof StringValue && To.IsToStringPure(realm, left) && !left.isTemporal()) {
    let suffix = right.value;
    if (method === "includes") {
      if (suffix.indexOf(needle) >= 0) return realm.intrinsics.true;
    } else if (method === "endsWith") {
      if (suffix.length >= needle.length) return new BooleanValue(realm, suffix.endsWith(needle));
      if (!needle.endsWith(suffix)) return realm.intrinsics.false;
    }
  }
  return undefined;
}

// The elements of a concrete array whose reads cannot run user code: an ordinary, unleaked
// array with a known length, inheriting from %ArrayPrototype%, and without holes or accessors.
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

// ECMA262 22.1.3.11 / 22.1.3.14 / 22.1.3.17 (ES2016): elements are compared with Strict Equality
// (indexOf, lastIndexOf) or SameValueZero (includes). Neither coerces or leaks `searchElement`.
function arraySearch(
  realm: Realm,
  context: Value,
  args: Array<Value>,
  method: "indexOf" | "lastIndexOf" | "includes"
): void | Value {
  let resultType = method === "includes" ? BooleanValue : NumberValue;
  let searchElement = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  let hasFromIndex = args.length > 1;
  let fromIndex = hasFromIndex ? args[1] : realm.intrinsics.undefined;

  let elements = getPlainArrayElements(realm, context, MaxSearchChain);
  if (elements !== undefined) {
    if (
      !(searchElement instanceof AbstractValue) &&
      !(fromIndex instanceof AbstractValue) &&
      !elements.some(e => e instanceof AbstractValue)
    ) {
      return undefined;
    }
    let len = elements.length;
    if (fromIndex instanceof UndefinedValue || fromIndex instanceof NumberValue) {
      let n;
      // For lastIndexOf, an explicit undefined is ToInteger(undefined) = 0, while an omitted arg defaults to len - 1.
      if (fromIndex instanceof UndefinedValue) n = method === "lastIndexOf" && !hasFromIndex ? len - 1 : 0;
      else n = isNaN(fromIndex.value) ? 0 : Math.trunc(fromIndex.value);

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

    // Abstract fromIndex on a small concrete array: `searchElement` and elements are only compared by identity.
    if (elements.length + 2 <= Placeholders.length) {
      let fromClass = classify(realm, fromIndex, "number");
      if (fromClass === "bail") return undefined;
      let params = Placeholders.slice(0, elements.length + 2);
      let fromParam = params.pop();
      let needleParam = params.pop();
      let templateSource = `[${params.join(", ")}].${method}(${needleParam}, ${fromParam})`;
      let inputs = [...elements, searchElement, fromIndex];
      let classifications = [...elements.map(() => "pure"), "pure", fromClass];
      return residualize(realm, templateSource, resultType, inputs, classifications, false);
    }
  }

  // Abstract or leaked array-like receiver (e.g. `Array.prototype.indexOf.call(list, needle)`):
  // `searchElement` is never coerced or leaked.
  if (ArrayValue.isIntrinsicAndHasWidenedNumericProperty(context)) return undefined;
  if (!isUnknown(context)) return undefined;
  let receiverClass = classifyArrayLikeReceiver(realm, context);
  if (receiverClass === "bail") return undefined;
  let inputs = [context, searchElement];
  let classifications = [receiverClass, "pure"];
  if (hasFromIndex) {
    let fromClass = classify(realm, fromIndex, "number");
    if (fromClass === "bail") return undefined;
    inputs.push(fromIndex);
    classifications.push(fromClass);
  }
  let params = Placeholders.slice(0, inputs.length);
  let templateSource = `global.Array.prototype.${method}.call(${params.join(", ")})`;
  return residualize(realm, templateSource, resultType, inputs, classifications, false);
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

// ECMA262 22.1.3.13: ToString(separator) (default ","), then each element is converted with ToString,
// except that undefined and null become the empty string.
function arrayJoin(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let separator = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  let elements = getPlainArrayElements(realm, context, Placeholders.length - 1);
  if (elements !== undefined) {
    if (!isUnknown(separator) && !elements.some(isUnknown)) return undefined;

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
    let classifications = elements.map(e => classifyJoinElement(realm, e));
    classifications.push(classify(realm, separator, "string"));
    if (classifications.indexOf("bail") >= 0) return undefined;
    let params = Placeholders.slice(0, elements.length + 1);
    let separatorParam = params.pop();
    let templateSource = `[${params.join(", ")}].join(${args.length > 0 ? separatorParam : ""})`;
    let inputs = args.length > 0 ? [...elements, separator] : elements;
    if (args.length === 0) classifications.pop();
    return residualize(realm, templateSource, StringValue, inputs, classifications, false);
  }

  if (ArrayValue.isIntrinsicAndHasWidenedNumericProperty(context) || !isUnknown(context)) return undefined;
  let receiverClass = classifyArrayLikeReceiver(realm, context);
  let sepClass = args.length > 0 ? classify(realm, separator, "string") : "pure";
  if (receiverClass === "bail" || sepClass === "bail") return undefined;
  let inputs = args.length > 0 ? [context, separator] : [context];
  let classifications = args.length > 0 ? [receiverClass, sepClass] : [receiverClass];
  let params = Placeholders.slice(0, inputs.length);
  return residualize(
    realm,
    `global.Array.prototype.join.call(${params.join(", ")})`,
    StringValue,
    inputs,
    classifications,
    false
  );
}

function classifyJoinElement(realm: Realm, element: Value): Classification {
  if (element instanceof UndefinedValue || element instanceof NullValue) return "pure";
  return classify(realm, element, "string");
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

// ECMA262 22.1.3.23 Array.prototype.slice(start, end) on a plain array of primitives or an abstract receiver.
function arraySlice(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let start = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  let end = args.length > 1 ? args[1] : realm.intrinsics.undefined;
  let startClass = classify(realm, start, "number");
  let endClass = args.length > 1 && !(end instanceof UndefinedValue) ? classify(realm, end, "number") : "pure";
  if (startClass === "bail" || endClass === "bail") return undefined;

  let elements = getPlainArrayElements(realm, context, Placeholders.length - 2);
  if (
    elements !== undefined &&
    context instanceof ArrayValue &&
    !context.properties.has("constructor") &&
    elements.every(e => !e.mightBeObject()) &&
    (isUnknown(start) || isUnknown(end))
  ) {
    let inputs = [...elements];
    let classifications = elements.map(() => "pure");
    let sliceArgs = [];
    if (args.length > 0) {
      sliceArgs.push(Placeholders[inputs.length]);
      inputs.push(start);
      classifications.push(startClass);
    }
    if (args.length > 1) {
      sliceArgs.push(Placeholders[inputs.length]);
      inputs.push(end);
      classifications.push(endClass);
    }
    let elemParams = Placeholders.slice(0, elements.length);
    let templateSource = `[${elemParams.join(", ")}].slice(${sliceArgs.join(", ")})`;
    if (realm.isInPureScope() && !realm.instantRender.enabled && classifications.every(c => c === "pure")) {
      return ArrayValue.createTemporalWithWidenedNumericProperty(
        realm,
        inputs,
        createOperationDescriptor("ABSTRACT_FROM_TEMPLATE", { templateSource })
      );
    }
    return residualize(realm, templateSource, ObjectValue, inputs, classifications, false);
  }

  if (ArrayValue.isIntrinsicAndHasWidenedNumericProperty(context) || !isUnknown(context)) return undefined;
  let receiverClass = classifyArrayLikeReceiver(realm, context);
  if (receiverClass === "bail") return undefined;
  let inputs = [context];
  let classifications = [receiverClass];
  if (args.length > 0) {
    inputs.push(start);
    classifications.push(startClass);
  }
  if (args.length > 1) {
    inputs.push(end);
    classifications.push(endClass);
  }
  let params = Placeholders.slice(0, inputs.length);
  return residualize(
    realm,
    `global.Array.prototype.slice.call(${params.join(", ")})`,
    ObjectValue,
    inputs,
    classifications,
    false
  );
}

// Placeholders recognized by `@babel/template` even on StringLiteral AST nodes.
function isTemplatePlaceholder(str: string): boolean {
  return str === "global" || (str.length === 1 && str >= "A" && str <= "Z");
}

function hasToJSONOnProtoChain(object: ObjectValue): boolean {
  let cur = object;
  while (cur instanceof ObjectValue) {
    let binding = cur.properties.get("toJSON");
    if (binding !== undefined && binding.descriptor !== undefined) return true;
    cur = cur.$Prototype;
  }
  return false;
}

function buildJsonValueTemplate(
  realm: Realm,
  value: Value,
  ancestors: Set<ObjectValue>,
  inputs: Array<Value>,
  classifications: Array<Classification>
): void | string {
  if (value instanceof BooleanValue) return value.value ? "true" : "false";
  if (value instanceof NullValue) return "null";
  if (value instanceof NumberValue) {
    if (!isFinite(value.value)) return "null";
    return Object.is(value.value, -0) ? "0" : String(value.value);
  }
  if (value instanceof StringValue) {
    if (!isTemplatePlaceholder(value.value)) return JSON.stringify(value.value);
    if (inputs.length >= Placeholders.length) return undefined;
    inputs.push(value);
    classifications.push("pure");
    return Placeholders[inputs.length - 1];
  }
  if (value instanceof ObjectValue) {
    return buildJsonContainerTemplate(realm, value, ancestors, inputs, classifications);
  }
  if (value instanceof AbstractValue) {
    if (inputs.length >= Placeholders.length) return undefined;
    inputs.push(value);
    classifications.push(classify(realm, value, "json"));
    return Placeholders[inputs.length - 1];
  }
  return undefined;
}

function buildJsonContainerTemplate(
  realm: Realm,
  object: ObjectValue,
  ancestors: Set<ObjectValue>,
  inputs: Array<Value>,
  classifications: Array<Classification>
): void | string {
  if (object instanceof ProxyValue || IsCallable(realm, object)) return undefined;
  if (object.isIntrinsic() || object.isPartialObject() || object.mightBeLeakedObject()) return undefined;
  if (object.unknownProperty !== undefined) return undefined;
  if (object.$NumberData !== undefined || object.$StringData !== undefined || object.$BooleanData !== undefined)
    return undefined;
  if (ancestors.has(object) || hasToJSONOnProtoChain(object)) return undefined;

  ancestors.add(object);
  try {
    if (object instanceof ArrayValue) {
      let elements = getPlainArrayElements(realm, object, 64);
      if (elements === undefined) return undefined;
      let parts = [];
      for (let elem of elements) {
        if (
          elem instanceof UndefinedValue ||
          elem instanceof SymbolValue ||
          (elem instanceof ObjectValue && IsCallable(realm, elem))
        ) {
          parts.push("null");
        } else {
          let expr = buildJsonValueTemplate(realm, elem, ancestors, inputs, classifications);
          if (expr === undefined) return undefined;
          parts.push(expr);
        }
      }
      return `[${parts.join(", ")}]`;
    }

    if (object.$Prototype !== realm.intrinsics.ObjectPrototype && !(object.$Prototype instanceof NullValue)) {
      return undefined;
    }
    for (let [, binding] of object.properties) {
      if (binding.descriptor === undefined) continue;
      if (!(binding.descriptor instanceof PropertyDescriptor)) return undefined;
      let val = binding.descriptor.value;
      if (!(val instanceof Value)) return undefined; // accessor
      if (val instanceof AbstractValue && val.mightHaveBeenDeleted()) return undefined;
    }
    let keys = EnumerableOwnProperties(realm, object, "key");
    let parts = [];
    for (let keyVal of keys) {
      if (!(keyVal instanceof StringValue)) return undefined;
      let key = keyVal.value;
      if (key === "__proto__" || isTemplatePlaceholder(key)) return undefined;
      let propVal = getOwnDataValue(object, key);
      if (
        propVal === undefined ||
        propVal instanceof UndefinedValue ||
        propVal instanceof SymbolValue ||
        (propVal instanceof ObjectValue && IsCallable(realm, propVal))
      ) {
        continue;
      }
      let expr = buildJsonValueTemplate(realm, propVal, ancestors, inputs, classifications);
      if (expr === undefined) return undefined;
      parts.push(`${JSON.stringify(key)}: ${expr}`);
    }
    return `{${parts.join(", ")}}`;
  } finally {
    ancestors.delete(object);
  }
}

// ECMA262 24.3.2 JSON.stringify(value) for single-argument calls on known-simple containers with
// abstract fields or on abstract values without a finite template.
function jsonStringify(realm: Realm, context: Value, args: Array<Value>): void | Value {
  if (args.length !== 1) return undefined;
  let value = args[0];

  if (value instanceof ObjectValue && !value.mightBeLeakedObject()) {
    let inputs = [];
    let classifications = [];
    let containerExpr = buildJsonContainerTemplate(realm, value, new Set(), inputs, classifications);
    if (containerExpr !== undefined && inputs.some(isUnknown) && classifications.indexOf("bail") < 0) {
      return residualize(realm, `global.JSON.stringify(${containerExpr})`, StringValue, inputs, classifications, false);
    }
    return undefined;
  }

  // Abstract values with a finite template are handled by JSON.js for the JSON.parse(JSON.stringify(x)) clone pattern.
  if (value instanceof AbstractValue && !value.values.isTop()) return undefined;
  if (!isUnknown(value)) return undefined;
  let classification = classify(realm, value, "json");
  if (classification === "bail") return undefined;
  let type = value.getType();
  let resultType =
    type === StringValue ||
    type === BooleanValue ||
    type === NullValue ||
    isNumberType(type) ||
    isCoercionPureSimpleObject(realm, value)
      ? StringValue
      : Value;
  return residualize(realm, "global.JSON.stringify(A)", resultType, [value], [classification], false);
}

// A concrete RegExp whose matching only depends on its source and flags: an unleaked ordinary
// RegExp instance inheriting from %RegExpPrototype% whose only own property is a writable
// lastIndex holding +0, and without the sticky flag. For such a RegExp, test/exec (without g),
// search, and replace/match/split (with or without g) leave lastIndex at +0, so the call can be
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
  return new RegExp(source, flags).toString();
}

// ECMA262 21.2.5.13 RegExp.prototype.test / 21.2.5.2 RegExp.prototype.exec with an abstract string.
function regExpCall(realm: Realm, context: Value, args: Array<Value>, method: "test" | "exec"): void | Value {
  let S = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  if (!isUnknown(S)) return undefined;
  let literal = getSimpleRegExpLiteral(realm, context, false);
  if (literal === undefined) return undefined;
  let classification = classify(realm, S, "string");
  if (classification === "bail") return undefined;
  // If the RegExp source contains "global", emit `global.RegExp...` so PreludeGenerator has a `global` identifier.
  let templateSource =
    literal.indexOf("global") >= 0
      ? `global.RegExp.prototype.${method}.call(${literal}, A)`
      : `${literal}.${method}(A)`;
  if (method === "test") return residualize(realm, templateSource, BooleanValue, [S], [classification], false);
  // exec returns a fresh array (or null) on every call, so the result is temporal.
  if (!realm.isInPureScope() || realm.instantRender.enabled) return undefined;
  if (classification === "pure") {
    return AbstractValue.createTemporalFromTemplate(realm, templateSource, Value, [S], { isPure: true });
  }
  return residualize(realm, templateSource, Value, [S], [classification], true);
}

// ECMA262 21.1.3.14 String.prototype.replace(searchValue, replaceValue) with a simple concrete RegExp
// or non-object searchValue, and a non-object (hence non-callable) replaceValue.
function stringReplace(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let searchValue = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  let replaceValue = args.length > 1 ? args[1] : realm.intrinsics.undefined;
  if (replaceValue.mightBeObject()) return undefined; // might be callable or coerce with user code

  let receiverClass = classifyReceiver(realm, context, "string");
  let replaceClass = classify(realm, replaceValue, "string");
  if (receiverClass === "bail" || replaceClass === "bail") return undefined;
  let isStringReceiver =
    context instanceof StringValue || (context instanceof AbstractValue && context.getType() === StringValue);

  let literal = getSimpleRegExpLiteral(realm, searchValue, true);
  if (literal !== undefined) {
    if (!isUnknown(context) && !isUnknown(replaceValue)) return undefined;
    let inputs = [context, replaceValue];
    let classifications = [receiverClass, replaceClass];
    let templateSource =
      isStringReceiver && literal.indexOf("global") < 0
        ? `A.replace(${literal}, B)`
        : `global.String.prototype.replace.call(A, ${literal}, B)`;
    return residualize(realm, templateSource, StringValue, inputs, classifications, false);
  }

  if (searchValue.mightBeObject()) return undefined;
  if (!isUnknown(context) && !isUnknown(searchValue) && !isUnknown(replaceValue)) return undefined;
  let searchClass = classify(realm, searchValue, "string");
  if (searchClass === "bail") return undefined;
  let inputs = [context, searchValue, replaceValue];
  let classifications = [receiverClass, searchClass, replaceClass];
  let templateSource = isStringReceiver ? "A.replace(B, C)" : "global.String.prototype.replace.call(A, B, C)";
  return residualize(realm, templateSource, StringValue, inputs, classifications, false);
}

// ECMA262 21.1.3.15 / 21.1.3.11: search(regexp), match(regexp) on an abstract string with a simple concrete RegExp.
function stringRegExpCall(realm: Realm, context: Value, args: Array<Value>, func: NativeFunctionValue): void | Value {
  if (!isUnknown(context)) return undefined;
  let method = func.name;
  let literal = getSimpleRegExpLiteral(realm, args[0], method !== "search");
  if (literal === undefined) return undefined;
  let receiverClassification = classifyReceiver(realm, context, "string");
  if (receiverClassification === "bail") return undefined;
  let inputs = [context];
  let classifications = [receiverClassification];
  let templateSource =
    receiverClassification === "pure" &&
    context instanceof AbstractValue &&
    context.getType() === StringValue &&
    literal.indexOf("global") < 0
      ? `A.${method}(${literal})`
      : `global.String.prototype.${method}.call(A, ${literal})`;
  if (method === "match") {
    // A fresh array (or null) on every call.
    if (!realm.isInPureScope() || realm.instantRender.enabled) return undefined;
    if (receiverClassification === "pure") {
      return AbstractValue.createTemporalFromTemplate(realm, templateSource, Value, inputs, { isPure: true });
    }
    return residualize(realm, templateSource, Value, inputs, classifications, true);
  }
  return residualize(realm, templateSource, NumberValue, inputs, classifications, false);
}

// ECMA262 21.1.3.17 String.prototype.split(separator, limit) with a simple concrete RegExp or
// primitive separator and an optional numeric limit.
function stringSplit(realm: Realm, context: Value, args: Array<Value>): void | Value {
  let separator = args.length > 0 ? args[0] : realm.intrinsics.undefined;
  let limit = args.length > 1 ? args[1] : realm.intrinsics.undefined;
  let receiverClass = classifyReceiver(realm, context, "string");
  let limitClass = args.length > 1 && !(limit instanceof UndefinedValue) ? classify(realm, limit, "number") : "pure";
  if (receiverClass === "bail" || limitClass === "bail") return undefined;
  let isStringReceiver =
    context instanceof StringValue || (context instanceof AbstractValue && context.getType() === StringValue);

  let literal = getSimpleRegExpLiteral(realm, separator, true);
  if (literal !== undefined) {
    if (!isUnknown(context) && !isUnknown(limit)) return undefined;
    let inputs = args.length > 1 ? [context, limit] : [context];
    let classifications = args.length > 1 ? [receiverClass, limitClass] : [receiverClass];
    let callArgs = args.length > 1 ? `${literal}, B` : literal;
    let templateSource =
      isStringReceiver && literal.indexOf("global") < 0
        ? `A.split(${callArgs})`
        : `global.String.prototype.split.call(A, ${callArgs})`;
    return residualize(realm, templateSource, ObjectValue, inputs, classifications, false);
  }

  if (separator.mightBeObject() && !isCoercionPureSimpleObject(realm, separator)) return undefined;
  if (!isUnknown(context) && !isUnknown(separator) && !isUnknown(limit)) return undefined;
  let sepClass = separator instanceof UndefinedValue ? "pure" : classify(realm, separator, "string");
  if (sepClass === "bail") return undefined;
  let inputs = [context];
  let classifications = [receiverClass];
  let splitParams = [];
  if (args.length > 0) {
    splitParams.push(Placeholders[inputs.length]);
    inputs.push(separator);
    classifications.push(sepClass);
  }
  if (args.length > 1) {
    splitParams.push(Placeholders[inputs.length]);
    inputs.push(limit);
    classifications.push(limitClass);
  }
  let templateSource = isStringReceiver
    ? `A.split(${splitParams.join(", ")})`
    : `global.String.prototype.split.call(A${splitParams.length > 0 ? ", " + splitParams.join(", ") : ""})`;
  return residualize(realm, templateSource, ObjectValue, inputs, classifications, false);
}
