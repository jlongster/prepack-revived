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
import type { LexicalEnvironment } from "../environment.js";
import { BigIntValue, HostBigInt, type Value } from "../values/index.js";
import type { BabelNode } from "@babel/types";

export default function(ast: BabelNode, strictCode: boolean, env: LexicalEnvironment, realm: Realm): Value {
  let raw = (ast: any).value;
  return new BigIntValue(realm, HostBigInt(raw));
}
