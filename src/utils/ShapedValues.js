/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import type { Realm } from "../realm.js";
import type { ShapeInformationInterface } from "../types.js";
import { AbstractValue, ArrayValue, StringValue, Value } from "../values/index.js";
import { createOperationDescriptor } from "./generator.js";
import invariant from "../invariant.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";

// Builds the value described by a (possibly union) shape. `read(type, shape)` produces a value that
// denotes the underlying runtime value, claiming the given type (the claim is only relied upon on
// the paths where the runtime discrimination below selected that variant).
//
// A union shape becomes a chain of conditionals that discriminates the raw value at runtime:
//   raw === undefined ? undefined : typeof raw === "string" ? <string view> : <object view>
// so a value of type `string | undefined` is precisely modelled, and code that tests it (typeof,
// == null, truthiness) gets refined branches instead of a top-typed value.
export function createShapedValue(
  realm: Realm,
  shape: ShapeInformationInterface,
  read: (type: typeof Value, shape: void | ShapeInformationInterface) => Value
): Value {
  let variants = shape.getVariants();
  if (variants === undefined) return read(shape.getAbstractType(), shape);
  let ordered = variants.slice().sort((a, b) => rank(a.getJSType()) - rank(b.getJSType()));
  let seen = new Set();
  for (let v of ordered) {
    let key = discriminant(v.getJSType());
    if (seen.has(key)) {
      let error = new CompilerDiagnostic(
        `union shape has more than one variant of runtime kind ${key}`,
        realm.currentLocation,
        "PP1008",
        "FatalError"
      );
      realm.handleError(error);
      throw new FatalError();
    }
    seen.add(key);
  }
  if (ordered.length === 1) return variantValue(realm, ordered[0], read);
  let raw = read(Value, undefined);
  invariant(raw instanceof AbstractValue);
  let view = (type, viewShape) => {
    if (type === ArrayValue) {
      let array = ArrayValue.createTemporalWithWidenedNumericProperty(
        realm,
        [raw],
        createOperationDescriptor("SINGLE_ARG")
      );
      array.shape = viewShape;
      return array;
    }
    return AbstractValue.createShapeView(realm, raw, type, viewShape);
  };
  let result = variantValue(realm, ordered[ordered.length - 1], view);
  for (let i = ordered.length - 2; i >= 0; i--) {
    let variant = ordered[i];
    let condition = variantTest(realm, variant.getJSType(), raw);
    result = AbstractValue.createFromConditionalOp(realm, condition, variantValue(realm, variant, view), result);
  }
  return result;
}

function rank(jsType: string): number {
  switch (jsType) {
    case "void":
      return 0;
    case "null":
      return 1;
    case "boolean":
      return 2;
    case "number":
    case "integral":
      return 3;
    case "string":
      return 4;
    default:
      return 5;
  }
}

function discriminant(jsType: string): string {
  switch (jsType) {
    case "integral":
      return "number";
    case "array":
    case "object":
      return "object";
    default:
      return jsType;
  }
}

function variantValue(
  realm: Realm,
  variant: ShapeInformationInterface,
  read: (type: typeof Value, shape: void | ShapeInformationInterface) => Value
): Value {
  switch (variant.getJSType()) {
    case "void":
      return realm.intrinsics.undefined;
    case "null":
      return realm.intrinsics.null;
    default:
      return read(variant.getAbstractType(), variant);
  }
}

function variantTest(realm: Realm, jsType: string, raw: Value): Value {
  switch (jsType) {
    case "void":
      return AbstractValue.createFromBinaryOp(realm, "===", raw, realm.intrinsics.undefined);
    case "null":
      return AbstractValue.createFromBinaryOp(realm, "===", raw, realm.intrinsics.null);
    default: {
      let typeName = discriminant(jsType);
      if (!(raw instanceof AbstractValue)) return realm.intrinsics.false;
      let typeOf = AbstractValue.createFromUnaryOp(realm, "typeof", raw);
      return AbstractValue.createFromBinaryOp(realm, "===", typeOf, new StringValue(realm, typeName));
    }
  }
}
