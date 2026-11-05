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
import type { ObjectValue } from "./index.js";
import { FunctionValue } from "./index.js";

/* Abstract base class for non-exotic function objects(either with source or built-in) */
export default class ECMAScriptFunctionValue extends FunctionValue {
  constructor(realm: Realm, intrinsicName?: string) {
    super(realm, intrinsicName);
    this.isCalledInMultipleContexts = false;
  }

  $ConstructorKind: "base" | "derived";
  $ThisMode: "lexical" | "strict" | "global";
  $HomeObject: void | ObjectValue;
  $FunctionKind: "normal" | "classConstructor" | "generator";
  isCalledInMultipleContexts: boolean;
  // Names given to the parameters of an optimized nested function (instead of their source names)
  // so that they cannot be captured by the parameters of other nested functions in the output.
  residualParameterNames: void | Array<string>;
}
