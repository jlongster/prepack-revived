/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { Realm } from "../../realm.js";
import type { PropertyKeyValue } from "../../types.js";
import type { BabelNodeSourceLocation } from "@babel/types";
import { CompilerDiagnostic, FatalError } from "../../errors.js";
import { AbstractJoinedDescriptor } from "../../descriptors.js";
import {
  AbstractObjectValue,
  AbstractValue,
  BooleanValue,
  ConcreteValue,
  FunctionValue,
  NumberValue,
  ObjectValue,
  StringValue,
  SymbolValue,
  Value,
} from "../../values/index.js";
import { createOperationDescriptor } from "../../utils/generator.js";
import invariant from "../../invariant.js";
import {
  GeneratedDOMGlobals,
  GeneratedNodeGlobals,
  GeneratedNodeModules,
  GeneratedShapes,
  GeneratedUMDGlobals,
  type ModelGlobalSpec,
  type ModelMethodSpec,
  type ModelScalarType,
} from "./generatedModels.js";
import { lookupTypeofGlobalAssumption, lookupTypeofPathAssumption, lookupValueAssumption } from "./assumptions.js";

function scalarTypeToAbstractType(scalar: ModelScalarType): typeof Value {
  switch (scalar) {
    case "string":
      return StringValue;
    case "number":
      return NumberValue;
    case "boolean":
      return BooleanValue;
    case "symbol":
      return SymbolValue;
    case "object":
      return ObjectValue;
    case "function":
    case "constructor":
      return FunctionValue;
    default:
      // Note: AbstractValue prohibits NullValue / UndefinedValue as primary type.
      return Value;
  }
}

function copyEnvMeta(from: AbstractValue, to: AbstractValue): void {
  to.isEnvironmentValue = true;
  if (from.envShapeName !== undefined) to.envShapeName = from.envShapeName;
  if (from.envMethodSpec !== undefined) to.envMethodSpec = from.envMethodSpec;
  if (from.envConstructorShape !== undefined) to.envConstructorShape = from.envConstructorShape;
  if (from.envPath !== undefined) to.envPath = from.envPath;
  if (from.envElementType !== undefined) to.envElementType = from.envElementType;
}

function applyNullability(realm: Realm, baseVal: AbstractValue, nullable?: boolean, optional?: boolean): AbstractValue {
  if (!nullable && !optional) return baseVal;
  // When baseVal already has top type Value, it already encompasses null and undefined.
  if (baseVal.getType() === Value) return baseVal;
  let concretes: Array<ConcreteValue> = [];
  if (nullable) concretes.push(realm.intrinsics.null);
  if (optional) concretes.push(realm.intrinsics.undefined);
  let union = AbstractValue.createAbstractConcreteUnion(realm, baseVal, concretes);
  copyEnvMeta(baseVal, union);
  return union;
}

export function getGlobalSpec(realm: Realm, name: string): void | ModelGlobalSpec {
  if (Object.prototype.hasOwnProperty.call(GeneratedUMDGlobals, name)) {
    return GeneratedUMDGlobals[name];
  }
  if (!realm.hasExplicitCompatibility || realm.isCompatibleWith("universal")) {
    if (Object.prototype.hasOwnProperty.call(GeneratedDOMGlobals, name)) return GeneratedDOMGlobals[name];
    if (Object.prototype.hasOwnProperty.call(GeneratedNodeGlobals, name)) return GeneratedNodeGlobals[name];
    return undefined;
  }
  if (realm.isCompatibleWith("node") || realm.isCompatibleWith("node-source-maps")) {
    if (Object.prototype.hasOwnProperty.call(GeneratedNodeGlobals, name)) return GeneratedNodeGlobals[name];
    if (Object.prototype.hasOwnProperty.call(GeneratedDOMGlobals, name)) return GeneratedDOMGlobals[name];
    return undefined;
  }
  if (realm.isCompatibleWith("browser") || realm.isCompatibleWith("fb-www") || realm.isCompatibleWith("node-react")) {
    if (Object.prototype.hasOwnProperty.call(GeneratedDOMGlobals, name)) return GeneratedDOMGlobals[name];
    if (Object.prototype.hasOwnProperty.call(GeneratedNodeGlobals, name)) return GeneratedNodeGlobals[name];
    return undefined;
  }
  return undefined;
}

export function isKnownGlobal(realm: Realm, name: string): boolean {
  return getGlobalSpec(realm, name) !== undefined;
}

function reportUnmodeledGlobalError(realm: Realm, name: string, loc: ?BabelNodeSourceLocation): empty {
  let diag = new CompilerDiagnostic(
    `Reference to unmodeled environment global '${name}'; supply a model, --assume, or --unknownGlobals open`,
    loc || realm.currentLocation,
    "PP0051",
    "FatalError"
  );
  realm.handleError(diag);
  throw new FatalError();
}

export function resolveTypeofGlobal(realm: Realm, name: string, loc: ?BabelNodeSourceLocation): Value {
  let assumed = lookupTypeofGlobalAssumption(realm, name);
  if (assumed !== undefined) return assumed;

  if (!realm.useAbstractInterpretation || realm.closedWorld) {
    return new StringValue(realm, "undefined");
  }
  // When the user explicitly declared a target `--compatibility`, resolve module-wrapper typeof probes:
  // Note: host feature globals (`window`, `document`, `navigator`, `Intl`, `MessageChannel`) stay residual
  // even under `--compatibility browser` so feature-detection guards remain safe in partial/SSR environments.
  if (realm.hasExplicitCompatibility) {
    if (
      realm.isCompatibleWith("browser") ||
      realm.isCompatibleWith(realm.MOBILE_JSC_VERSION) ||
      realm.isCompatibleWith("mobile") ||
      realm.isCompatibleWith("node-react") ||
      realm.isCompatibleWith("fb-www")
    ) {
      if (name === "exports" || name === "module" || name === "define") {
        return new StringValue(realm, "undefined");
      }
    } else if (realm.isCompatibleWith("node")) {
      if (name === "module" || name === "exports" || name === "global") {
        return new StringValue(realm, "object");
      }
      if (name === "require") {
        return new StringValue(realm, "function");
      }
      if (name === "define") {
        return new StringValue(realm, "undefined");
      }
    }
  }
  if (realm.unknownGlobals === "error" && !isKnownGlobal(realm, name)) {
    reportUnmodeledGlobalError(realm, name, loc);
  }

  let cached = realm._typeofGlobalValues.get(name);
  if (cached !== undefined) return cached;

  let abs = AbstractValue.createFromBuildFunction(
    realm,
    StringValue,
    [],
    createOperationDescriptor("TYPEOF_GLOBAL", { id: name }),
    { kind: AbstractValue.makeKind("typeofGlobal", name) }
  );
  invariant(abs instanceof AbstractValue);
  abs.isEnvironmentValue = true;
  abs.envPath = `typeof ${name}`;
  realm._typeofGlobalValues.set(name, abs);
  return abs;
}

export function resolveTypeofEnvironmentValue(realm: Realm, val: AbstractValue): void | Value {
  if (!isEnvironmentDerived(val) || realm.closedWorld || !realm.useAbstractInterpretation) return undefined;
  if (val.envPath !== undefined) {
    let assumed = lookupTypeofPathAssumption(realm, val.envPath);
    if (assumed !== undefined) return assumed;
  }
  // Primitive non-optional modeled properties (e.g. navigator.userAgent: string) have a known typeof.
  let t = val.getType();
  if (
    (t === StringValue || t === NumberValue || t === BooleanValue || t === SymbolValue || t === FunctionValue) &&
    !val.mightBeNull() &&
    !val.mightBeUndefined()
  ) {
    return undefined;
  }
  // Host objects, constructors, and methods (e.g. root.fetch, window.document.createElement, performance.mark)
  // are frequently probed for feature detection and may be absent on older runtimes; keep typeof residual.
  let res = AbstractValue.createFromBuildFunction(
    realm,
    StringValue,
    [val],
    createOperationDescriptor("UNARY_EXPRESSION", { unaryOperator: "typeof", prefix: true }),
    { kind: "typeof" }
  );
  invariant(res instanceof AbstractValue);
  res = AbstractValue.convertToTemporalIfArgsAreTemporal(realm, res, [val]);
  res.isEnvironmentValue = true;
  return res;
}

export function resolveFreeGlobal(realm: Realm, name: string, loc: ?BabelNodeSourceLocation): void | Value {
  let assumed = lookupValueAssumption(realm, name);
  if (assumed !== undefined) return assumed;

  if (!realm.useAbstractInterpretation || realm.closedWorld) {
    return undefined;
  }
  if (realm.unknownGlobals === "error" && !isKnownGlobal(realm, name)) {
    reportUnmodeledGlobalError(realm, name, loc);
  }

  // Whenever `window` or `self` exists at runtime, it aliases the global object (`globalThis`).
  // Returning `realm.$GlobalObject` unifies `window`, `self`, `global`, and `globalThis` while
  // keeping `typeof window` and `typeof self` residual when `--compatibility` was not declared.
  if (name === "window" || name === "self") {
    return realm.$GlobalObject;
  }

  let cached = realm._envGlobals.get(name);
  if (cached !== undefined) return cached;

  let spec = getGlobalSpec(realm, name);
  let baseType: typeof Value = Value;
  let shapeName: void | string;
  let methodSpec: void | ModelMethodSpec;
  let ctorShape: void | string;
  let nullable = false;
  let optional = false;

  if (spec !== undefined) {
    if (spec.k === "var") {
      baseType = scalarTypeToAbstractType(spec.t);
      shapeName = spec.s;
      nullable = !!spec.n;
      optional = !!spec.o;
    } else if (spec.k === "fn") {
      baseType = FunctionValue;
      shapeName = spec.s;
      methodSpec = { r: spec.r, s: spec.s, n: spec.n, o: spec.o };
    } else if (spec.k === "asyncFn") {
      baseType = FunctionValue;
      methodSpec = { r: spec.r };
    } else if (spec.k === "ctor") {
      baseType = FunctionValue;
      ctorShape = spec.s;
      if (ctorShape !== undefined && Object.prototype.hasOwnProperty.call(GeneratedShapes, `${ctorShape}Constructor`)) {
        shapeName = `${ctorShape}Constructor`;
      }
    }
  }

  let abs = AbstractValue.createFromBuildFunction(
    realm,
    baseType,
    [],
    createOperationDescriptor("ENV_GLOBAL", { id: name }),
    { kind: AbstractValue.makeKind("envGlobal", name) }
  );
  invariant(abs instanceof AbstractValue);
  abs.isEnvironmentValue = true;
  abs.envPath = name;
  if (shapeName !== undefined) abs.envShapeName = shapeName;
  if (methodSpec !== undefined) abs.envMethodSpec = methodSpec;
  if (ctorShape !== undefined) abs.envConstructorShape = ctorShape;

  let finalVal = applyNullability(realm, abs, nullable, optional);
  realm._envGlobals.set(name, finalVal);
  return finalVal;
}

export function resolveGlobalObjectProperty(realm: Realm, P: PropertyKeyValue): void | Value {
  if (
    !realm.useAbstractInterpretation ||
    realm.closedWorld ||
    realm.isReadOnly ||
    realm.generator === undefined ||
    typeof P !== "string" ||
    P.startsWith("__")
  ) {
    return undefined;
  }

  let assumed = lookupValueAssumption(realm, P);
  if (assumed !== undefined) return assumed;

  // `self.self === self` and `window.window === window` hold on the global object.
  if (P === "self" || P === "window") {
    return realm.$GlobalObject;
  }

  let spec = getGlobalSpec(realm, P);
  if (spec === undefined) return undefined;

  let baseType: typeof Value = Value;
  let shapeName: void | string;
  let methodSpec: void | ModelMethodSpec;
  let ctorShape: void | string;
  let nullable = false;
  // On `global` / `this`, host-specific globals may be absent on another platform, so mark optional unless primitive.
  let optional = true;

  if (spec.k === "var") {
    baseType = scalarTypeToAbstractType(spec.t);
    shapeName = spec.s;
    nullable = !!spec.n;
    optional = spec.o !== undefined ? !!spec.o : true;
  } else if (spec.k === "fn" || spec.k === "asyncFn") {
    baseType = FunctionValue;
    methodSpec = spec.k === "fn" ? { r: spec.r, s: spec.s, n: spec.n, o: spec.o } : { r: spec.r };
    if (spec.k === "fn" && spec.s !== undefined) shapeName = spec.s;
  } else if (spec.k === "ctor") {
    baseType = FunctionValue;
    ctorShape = spec.s;
    if (ctorShape !== undefined && Object.prototype.hasOwnProperty.call(GeneratedShapes, `${ctorShape}Constructor`)) {
      shapeName = `${ctorShape}Constructor`;
    }
  }

  let propNode = new StringValue(realm, P);
  let abs = AbstractValue.createTemporalFromBuildFunction(
    realm,
    baseType,
    [realm.$GlobalObject, propNode],
    createOperationDescriptor("ABSTRACT_OBJECT_GET", {}),
    { skipInvariant: true, isPure: true }
  );
  invariant(abs instanceof AbstractValue);
  abs.isEnvironmentValue = true;
  abs.envPath = P;
  if (shapeName !== undefined) abs.envShapeName = shapeName;
  if (methodSpec !== undefined) abs.envMethodSpec = methodSpec;
  if (ctorShape !== undefined) abs.envConstructorShape = ctorShape;

  return applyNullability(realm, abs, nullable, optional);
}

export function isEnvironmentDerived(val: Value): boolean {
  if (!(val instanceof AbstractValue)) return false;
  if (val.isEnvironmentValue) return true;
  if (
    (val.kind === "conditional" || val.kind === "||" || val.kind === "&&" || val.kind === "abstractConcreteUnion") &&
    val.args.length >= 2
  ) {
    for (let i = 0; i < val.args.length; i++) {
      if (isEnvironmentDerived(val.args[i])) return true;
    }
  }
  if (
    (val.kind === "!" || val.kind === "typeof" || val.kind === "explicit conversion to object") &&
    val.args.length === 1
  ) {
    return isEnvironmentDerived(val.args[0]);
  }
  if (
    (val.kind === "===" ||
      val.kind === "!==" ||
      val.kind === "==" ||
      val.kind === "!=" ||
      val.kind === "<" ||
      val.kind === "in") &&
    val.args.length === 2
  ) {
    return isEnvironmentDerived(val.args[0]) || isEnvironmentDerived(val.args[1]);
  }
  return false;
}

function unwrapAtomicEnvCondition(realm: Realm, rawCond: AbstractValue): void | AbstractValue {
  let cond = realm.simplifyAndRefineAbstractCondition(rawCond);
  while (cond instanceof AbstractValue && (cond.kind === "&&" || cond.kind === "||" || cond.kind === "!")) {
    if (cond.kind === "!") {
      cond = realm.simplifyAndRefineAbstractCondition((cond.args[0]: any));
      continue;
    }
    let left = realm.simplifyAndRefineAbstractCondition((cond.args[0]: any));
    if (left instanceof AbstractValue) {
      cond = left;
    } else {
      cond = realm.simplifyAndRefineAbstractCondition((cond.args[1]: any));
    }
  }
  if (cond instanceof AbstractValue && isEnvironmentDerived(cond)) return cond;
  return undefined;
}

export function findEnvEnumerationSplitCondition(realm: Realm, val: Value): void | AbstractValue {
  if (val instanceof AbstractObjectValue && val.kind === "conditional") {
    return unwrapAtomicEnvCondition(realm, (val.args[0]: any));
  }
  if (!(val instanceof ObjectValue)) return undefined;
  for (let [, pb] of val.properties) {
    if (!pb || pb.descriptor === undefined) continue;
    let desc = pb.descriptor;
    if (desc instanceof AbstractJoinedDescriptor) {
      let c = unwrapAtomicEnvCondition(realm, desc.joinCondition);
      if (c !== undefined) return c;
      continue;
    }
    let pv = (desc: any).value;
    if (pv instanceof AbstractValue && pv.mightHaveBeenDeleted()) {
      let saved = AbstractValue._preservingEmpty;
      AbstractValue._preservingEmpty = true;
      let simplified;
      try {
        simplified = realm.simplifyAndRefineAbstractValue(pv);
      } finally {
        AbstractValue._preservingEmpty = saved;
      }
      if (simplified instanceof AbstractValue && simplified.kind === "conditional") {
        let c = unwrapAtomicEnvCondition(realm, (simplified.args[0]: any));
        if (c !== undefined) return c;
      }
    }
  }
  return undefined;
}

export function getEnvironmentProperty(
  realm: Realm,
  baseObj: AbstractObjectValue,
  receiver: Value,
  P: PropertyKeyValue
): Value {
  let ob = baseObj.kind === "explicit conversion to object" ? baseObj.args[0] : receiver;
  if (ob instanceof AbstractObjectValue && ob.kind === "explicit conversion to object") {
    ob = ob.args[0];
  }
  let propNameStr = P instanceof StringValue ? P.value : typeof P === "string" ? P : undefined;
  let nextPath =
    propNameStr !== undefined && baseObj.envPath !== undefined ? `${baseObj.envPath}.${propNameStr}` : undefined;

  if (nextPath !== undefined) {
    let assumed = lookupValueAssumption(realm, nextPath);
    if (assumed !== undefined) return assumed;
  }

  // Memoize `define.amd` so multi-UMD bundles share the identical AMD guard condition across headers.
  if (nextPath === "define.amd") {
    let cachedAmd = realm._envGlobals.get("define.amd");
    if (cachedAmd !== undefined) return cachedAmd;
    let amdVal = AbstractValue.createFromBuildFunction(
      realm,
      Value,
      [ob, new StringValue(realm, "amd")],
      createOperationDescriptor("ABSTRACT_OBJECT_GET", {}),
      { kind: AbstractValue.makeKind("envGlobal", "define.amd") }
    );
    invariant(amdVal instanceof AbstractValue);
    amdVal.isEnvironmentValue = true;
    amdVal.envPath = "define.amd";
    realm._envGlobals.set("define.amd", amdVal);
    return amdVal;
  }

  let baseType: typeof Value = Value;
  let shapeName: void | string;
  let methodSpec: void | ModelMethodSpec;
  let ctorShape: void | string;
  let nullable = false;
  let optional = false;

  if (propNameStr !== undefined && baseObj.envElementType !== undefined) {
    if (propNameStr === "0") {
      baseType = baseObj.envElementType;
    } else if (propNameStr === "length") {
      baseType = NumberValue;
    }
  }

  let ownerShapeName = baseObj.envShapeName;
  if (
    propNameStr !== undefined &&
    ownerShapeName !== undefined &&
    Object.prototype.hasOwnProperty.call(GeneratedShapes, ownerShapeName)
  ) {
    let shape = GeneratedShapes[ownerShapeName];
    if (shape.methods && Object.prototype.hasOwnProperty.call(shape.methods, propNameStr)) {
      let m = shape.methods[propNameStr];
      baseType = FunctionValue;
      methodSpec = m;
      optional = true;
    } else if (shape.props && Object.prototype.hasOwnProperty.call(shape.props, propNameStr)) {
      let p = shape.props[propNameStr];
      if (p.t === "constructor") {
        baseType = FunctionValue;
        ctorShape = p.s;
      } else {
        baseType = scalarTypeToAbstractType(p.t);
        shapeName = p.s;
        nullable = !!p.n;
        optional = !!p.o || ownerShapeName === "Window";
      }
    } else if (shape.index !== undefined) {
      let idx = shape.index;
      baseType = scalarTypeToAbstractType(idx.t);
      shapeName = idx.s;
      nullable = !!idx.n;
      optional = !!idx.o;
    }
  }

  let keyVal = typeof P === "string" ? new StringValue(realm, P) : P;
  let abs = AbstractValue.createTemporalFromBuildFunction(
    realm,
    baseType,
    [ob, keyVal],
    createOperationDescriptor("ABSTRACT_OBJECT_GET", {}),
    { skipInvariant: true, isPure: true }
  );
  invariant(abs instanceof AbstractValue);
  abs.isEnvironmentValue = true;
  if (nextPath !== undefined) abs.envPath = nextPath;
  if (shapeName !== undefined) abs.envShapeName = shapeName;
  if (methodSpec !== undefined) abs.envMethodSpec = methodSpec;
  if (ctorShape !== undefined) abs.envConstructorShape = ctorShape;

  return applyNullability(realm, abs, nullable, optional);
}

export function createEnvironmentCallResult(
  realm: Realm,
  func: Value,
  thisArg: void | Value,
  propName: void | PropertyKeyValue | AbstractValue,
  argsWithCallee: Array<Value>,
  callArgs: Array<Value>
): Value {
  // Check if calling `require("<builtin>")` for a modeled Node built-in module.
  if (
    func instanceof AbstractValue &&
    func.envPath === "require" &&
    callArgs.length >= 1 &&
    callArgs[0] instanceof StringValue
  ) {
    let modName = callArgs[0].value;
    if (Object.prototype.hasOwnProperty.call(GeneratedNodeModules, modName)) {
      let modShape = GeneratedNodeModules[modName];
      let res = AbstractValue.createTemporalFromBuildFunction(
        realm,
        Value,
        argsWithCallee,
        createOperationDescriptor("CALL_BAILOUT", { propRef: (propName: any), thisArg })
      );
      invariant(res instanceof AbstractValue);
      res.isEnvironmentValue = true;
      res.envShapeName = modShape;
      res.envPath = `require(${JSON.stringify(modName)})`;
      return res;
    }
  }

  let methodSpec: void | ModelMethodSpec = func instanceof AbstractValue ? func.envMethodSpec : undefined;
  if (
    methodSpec === undefined &&
    thisArg instanceof AbstractValue &&
    thisArg.envShapeName !== undefined &&
    typeof propName === "string"
  ) {
    let ownerShape = GeneratedShapes[thisArg.envShapeName];
    if (ownerShape && ownerShape.methods && Object.prototype.hasOwnProperty.call(ownerShape.methods, propName)) {
      methodSpec = ownerShape.methods[propName];
    }
  }

  let baseType: typeof Value =
    methodSpec !== undefined
      ? scalarTypeToAbstractType(methodSpec.r)
      : (func instanceof AbstractObjectValue ? func.functionResultType : undefined) || Value;
  let res = AbstractValue.createTemporalFromBuildFunction(
    realm,
    baseType,
    argsWithCallee,
    createOperationDescriptor("CALL_BAILOUT", { propRef: (propName: any), thisArg })
  );
  invariant(res instanceof AbstractValue);
  res.isEnvironmentValue = true;
  if (methodSpec !== undefined) {
    if (methodSpec.s !== undefined) res.envShapeName = methodSpec.s;
    return applyNullability(realm, res, !!methodSpec.n, !!methodSpec.o);
  }
  return res;
}

export function constructEnvironmentObject(
  realm: Realm,
  constructor: AbstractValue,
  argsList: Array<Value>,
  baseObj?: Value,
  propName?: string
): AbstractObjectValue {
  let ctorVal = constructor.kind === "abstractConcreteUnion" ? constructor.args[0] : constructor;
  let instanceShape =
    (ctorVal instanceof AbstractValue ? ctorVal.envConstructorShape : undefined) || constructor.envConstructorShape;
  let opArgs = baseObj !== undefined && propName !== undefined ? [baseObj, ...argsList] : [ctorVal, ...argsList];
  let opDesc =
    baseObj !== undefined && propName !== undefined
      ? createOperationDescriptor("NEW_EXPRESSION", { propRef: propName })
      : createOperationDescriptor("NEW_EXPRESSION");
  let res = AbstractValue.createTemporalFromBuildFunction(realm, ObjectValue, opArgs, opDesc);
  invariant(res instanceof AbstractObjectValue);
  res.isEnvironmentValue = true;
  if (instanceShape !== undefined) res.envShapeName = instanceShape;
  return res;
}
