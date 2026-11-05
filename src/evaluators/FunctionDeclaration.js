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
import type { Value } from "../values/index.js";
import { MakeConstructor } from "../methods/construct.js";
import { Create, Functions, Properties } from "../singletons.js";
import { StringValue } from "../values/index.js";
import IsStrict from "../utils/strict.js";
import { PropertyDescriptor } from "../descriptors.js";
import type { BabelNodeFunctionDeclaration } from "@babel/types";

// ECMA262 14.1.20
export default function(
  ast: BabelNodeFunctionDeclaration,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  let strict = strictCode || IsStrict(ast.body);
  let name = ast.id ? new StringValue(realm, ast.id.name) : new StringValue(realm, "default");

  if (ast.generator && ast.async) {
    let F = Functions.AsyncGeneratorFunctionCreate(realm, "normal", ast.params, ast.body, env, strict);
    if (ast.id && ast.id.name) F.__originalName = ast.id.name;
    F.loc = ast.loc;
    let prototype = Create.ObjectCreate(realm, realm.intrinsics.AsyncGeneratorPrototype);
    prototype.originalConstructor = F;
    Properties.DefinePropertyOrThrow(
      realm,
      F,
      "prototype",
      new PropertyDescriptor({
        value: prototype,
        writable: true,
        enumerable: false,
        configurable: false,
      })
    );
    Functions.SetFunctionName(realm, F, name);
    return F;
  } else if (ast.generator) {
    let F = Functions.GeneratorFunctionCreate(realm, "normal", ast.params, ast.body, env, strict);
    if (ast.id && ast.id.name) F.__originalName = ast.id.name;
    F.loc = ast.loc;
    let prototype = Create.ObjectCreate(realm, realm.intrinsics.GeneratorPrototype);
    prototype.originalConstructor = F;
    Properties.DefinePropertyOrThrow(
      realm,
      F,
      "prototype",
      new PropertyDescriptor({
        value: prototype,
        writable: true,
        enumerable: false,
        configurable: false,
      })
    );
    Functions.SetFunctionName(realm, F, name);
    return F;
  } else if (ast.async) {
    let F = Functions.AsyncFunctionCreate(realm, "normal", ast.params, ast.body, env, strict);
    if (ast.id && ast.id.name) F.__originalName = ast.id.name;
    F.loc = ast.loc;
    Functions.SetFunctionName(realm, F, name);
    return F;
  } else {
    // 3. Let F be FunctionCreate(Normal, FormalParameters, FunctionBody, scope, strict).
    let F = Functions.FunctionCreate(realm, "normal", ast.params, ast.body, env, strict, undefined, !!ast.async);
    if (ast.id && ast.id.name) F.__originalName = ast.id.name;

    if (!ast.async) {
      // 4. Perform MakeConstructor(F).
      MakeConstructor(realm, F);
    }

    // 5. Perform SetFunctionName(F, name).
    Functions.SetFunctionName(realm, F, name);

    // 6. Return F.
    return F;
  }
}
