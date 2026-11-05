/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import { PrimitiveValue, Value } from "./index.js";
import type { Realm } from "../realm.js";

const hostGlobal: any = new Function("return this")(); // eslint-disable-line no-new-func
export const HostBigInt: any = hostGlobal.BigInt;
export const bigIntPow: (any, any) => any = (new Function("a", "b", "return a ** b;"): any); // eslint-disable-line no-new-func

export default class BigIntValue extends PrimitiveValue {
  constructor(realm: Realm, value: any, intrinsicName?: string) {
    super(realm, intrinsicName);
    let t: string = typeof value;
    this.value = t === "bigint" ? value : HostBigInt(value);
  }

  value: any;

  equals(x: Value): boolean {
    return x instanceof BigIntValue && this.value === x.value;
  }

  getHash(): number {
    let str = this.value.toString();
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h | 0;
  }

  mightBeFalse(): boolean {
    return this.value === HostBigInt(0);
  }

  _serialize(): any {
    return this.value;
  }

  toDisplayString(): string {
    return this.value.toString() + "n";
  }
}
