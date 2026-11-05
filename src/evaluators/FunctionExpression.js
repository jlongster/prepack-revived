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
import { MakeConstructor } from "../methods/index.js";
import { Create, Environment, Functions, Properties } from "../singletons.js";
import { StringValue } from "../values/index.js";
import IsStrict from "../utils/strict.js";
import type { BabelNodeFunctionExpression } from "@babel/types";
import invariant from "../invariant.js";
import { PropertyDescriptor } from "../descriptors.js";

export default function(
  ast: BabelNodeFunctionExpression,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  // ECMA262 14.1.21

  let strict = strictCode || IsStrict(ast.body);
  let isGenerator = ast.generator === true;
  let isAsync = ast.async === true;

  if (ast.id) {
    let scope = env;
    let isNormal = !isGenerator && !isAsync;
    let funcEnv = isNormal
      ? Environment.NewDeclarativeEnvironment(realm, scope, false)
      : Environment.NewDeclarativeEnvironment(realm, scope);
    let envRec = funcEnv.environmentRecord;
    invariant(ast.id);
    let name = ast.id.name;
    if (isNormal) {
      envRec.CreateImmutableBinding(name, false, false, true);
    } else {
      envRec.CreateImmutableBinding(name, false);
    }

    let closure;
    if (isGenerator && isAsync) {
      closure = Functions.AsyncGeneratorFunctionCreate(realm, "normal", ast.params, ast.body, funcEnv, strict);
      closure.loc = ast.loc;
      let prototype = Create.ObjectCreate(realm, realm.intrinsics.AsyncGeneratorPrototype);
      prototype.originalConstructor = closure;
      Properties.DefinePropertyOrThrow(
        realm,
        closure,
        "prototype",
        new PropertyDescriptor({ value: prototype, writable: true, enumerable: false, configurable: false })
      );
    } else if (isGenerator) {
      closure = Functions.GeneratorFunctionCreate(realm, "normal", ast.params, ast.body, funcEnv, strict);
      closure.loc = ast.loc;
      let prototype = Create.ObjectCreate(realm, realm.intrinsics.GeneratorPrototype);
      prototype.originalConstructor = closure;
      Properties.DefinePropertyOrThrow(
        realm,
        closure,
        "prototype",
        new PropertyDescriptor({ value: prototype, writable: true, enumerable: false, configurable: false })
      );
    } else if (isAsync) {
      closure = Functions.AsyncFunctionCreate(realm, "normal", ast.params, ast.body, funcEnv, strict);
      closure.loc = ast.loc;
    } else {
      closure = Functions.FunctionCreate(realm, "normal", ast.params, ast.body, funcEnv, strict);
      closure.loc = ast.loc;
      MakeConstructor(realm, closure);
    }

    Functions.SetFunctionName(realm, closure, new StringValue(realm, name));
    if (isNormal) {
      envRec.InitializeBinding(name, closure, true);
    } else {
      envRec.InitializeBinding(name, closure);
    }
    return closure;
  } else {
    let scope = env;
    if (isGenerator && isAsync) {
      let closure = Functions.AsyncGeneratorFunctionCreate(realm, "normal", ast.params, ast.body, scope, strict);
      closure.loc = ast.loc;
      let prototype = Create.ObjectCreate(realm, realm.intrinsics.AsyncGeneratorPrototype);
      prototype.originalConstructor = closure;
      Properties.DefinePropertyOrThrow(
        realm,
        closure,
        "prototype",
        new PropertyDescriptor({ value: prototype, writable: true, enumerable: false, configurable: false })
      );
      return closure;
    } else if (isGenerator) {
      let closure = Functions.GeneratorFunctionCreate(realm, "normal", ast.params, ast.body, scope, strict);
      closure.loc = ast.loc;
      let prototype = Create.ObjectCreate(realm, realm.intrinsics.GeneratorPrototype);
      prototype.originalConstructor = closure;
      Properties.DefinePropertyOrThrow(
        realm,
        closure,
        "prototype",
        new PropertyDescriptor({ value: prototype, writable: true, enumerable: false, configurable: false })
      );
      return closure;
    } else if (isAsync) {
      let closure = Functions.AsyncFunctionCreate(realm, "normal", ast.params, ast.body, scope, strict);
      closure.loc = ast.loc;
      return closure;
    } else {
      let closure = Functions.FunctionCreate(realm, "normal", ast.params, ast.body, scope, strict);
      closure.loc = ast.loc;
      MakeConstructor(realm, closure);
      return closure;
    }
  }
}
