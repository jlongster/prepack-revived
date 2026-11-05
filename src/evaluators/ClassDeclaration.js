/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import type { Realm } from "../realm.js";
import { DeclarativeEnvironmentRecord, type LexicalEnvironment } from "../environment.js";
import type { ClassInstanceElement } from "../types.js";
import {
  AbstractValue,
  EmptyValue,
  ECMAScriptFunctionValue,
  type ECMAScriptSourceFunctionValue,
  NullValue,
  ObjectValue,
  StringValue,
  SymbolValue,
  UndefinedValue,
  Value,
} from "../values/index.js";
import { CompilerDiagnostic, FatalError } from "../errors.js";
import { PropertyDescriptor } from "../descriptors.js";
import * as t from "@babel/types";
import type {
  BabelNodeClassDeclaration,
  BabelNodeClassExpression,
  BabelNodeClassMethod,
  BabelNodeExpression,
} from "@babel/types";
import parse from "../utils/parse.js";
import { EvalPropertyName } from "./ObjectExpression.js";
import {
  Call,
  HasOwnProperty,
  IsAnonymousFunctionDefinition,
  IsConstructor,
  Get,
  MakeConstructor,
  MakeClassConstructor,
  ConstructorMethod,
  IsStatic,
} from "../methods/index.js";
import { Create, Environment, Functions, Properties } from "../singletons.js";
import invariant from "../invariant.js";

function EvaluateClassHeritage(
  realm: Realm,
  ClassHeritage: BabelNodeExpression,
  strictCode: boolean
): ObjectValue | null {
  let ref = realm.getRunningContext().lexicalEnvironment.evaluate(ClassHeritage, strictCode);
  let val = Environment.GetValue(realm, ref);
  if (val instanceof AbstractValue) {
    let error = new CompilerDiagnostic("unknown super class", ClassHeritage.loc, "PP0009", "RecoverableError");
    if (realm.handleError(error) === "Fail") throw new FatalError();
  }
  if (!(val instanceof ObjectValue)) {
    return null;
  }
  return val;
}

// ECMA262 14.5.14
export function ClassDefinitionEvaluation(
  realm: Realm,
  ast: BabelNodeClassDeclaration | BabelNodeClassExpression,
  className: string | void,
  strictCode: boolean,
  env: LexicalEnvironment
): ECMAScriptSourceFunctionValue {
  // 1. Let lex be the LexicalEnvironment of the running execution context.
  let lex = env;

  // 2. Let classScope be NewDeclarativeEnvironment(lex).
  // Pass active=false so classScope stays alive for methods and field initializers that capture className or private names.
  let classScope = Environment.NewDeclarativeEnvironment(realm, lex, false);
  let F;

  // 3. Let classScopeEnvRec be classScope’s EnvironmentRecord.
  let classScopeEnvRec = classScope.environmentRecord;
  invariant(classScopeEnvRec instanceof DeclarativeEnvironmentRecord);

  // Collect any private identifiers (#x, #m) declared in this class body.
  let privateBindings: Map<string, SymbolValue> = new Map();
  for (let rawElem of ast.body.body) {
    let elem: any = rawElem;
    if (
      elem.type === "ClassPrivateProperty" ||
      (elem.type === "ClassMethod" && elem.key && elem.key.type === "PrivateName")
    ) {
      let pName: string = elem.key.id.name;
      if (!privateBindings.has(pName)) {
        let sym = new SymbolValue(realm, new StringValue(realm, "#" + pName));
        sym.$IsPrivateName = true;
        sym.$PrivateName = pName;
        privateBindings.set(pName, sym);
      }
    }
  }
  if (privateBindings.size > 0) {
    classScopeEnvRec.$PrivateBindings = privateBindings;
  }

  // 4. If className is not undefined, then
  if (className !== undefined) {
    // a. Perform classScopeEnvRec.CreateImmutableBinding(className, true).
    classScopeEnvRec.CreateImmutableBinding(className, true, false, true);
  }

  let protoParent;
  let constructorParent;
  // 5. If ClassHeritage opt is not present, then
  let ClassHeritage = ast.superClass;
  if (!ClassHeritage) {
    // a. Let protoParent be the intrinsic object %ObjectPrototype%.
    protoParent = realm.intrinsics.ObjectPrototype;

    // b. Let constructorParent be the intrinsic object %FunctionPrototype%.
    constructorParent = realm.intrinsics.FunctionPrototype;
  } else {
    // 6. Else
    // a. Set the running execution context’s LexicalEnvironment to classScope.
    realm.getRunningContext().lexicalEnvironment = classScope;
    let superclass = null;
    try {
      // b. Let superclass be the result of evaluating ClassHeritage.
      superclass = EvaluateClassHeritage(realm, ClassHeritage, true);
    } finally {
      // c. Set the running execution context’s LexicalEnvironment to lex.
      realm.getRunningContext().lexicalEnvironment = lex;
    }

    // d. ReturnIfAbrupt(superclass).

    // e. If superclass is null, then
    if (superclass === null) {
      // i. Let protoParent be null.
      protoParent = realm.intrinsics.null;

      // ii. Let constructorParent be the intrinsic object %FunctionPrototype%.
      constructorParent = realm.intrinsics.FunctionPrototype;
    } else if (!IsConstructor(realm, superclass)) {
      // f. Else if IsConstructor(superclass) is false, throw a TypeError exception.
      throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "superclass must be a constructor");
    } else {
      // g. Else
      // i. If superclass has a [[FunctionKind]] internal slot whose value is "generator", throw a TypeError exception.
      if (superclass instanceof ECMAScriptFunctionValue && superclass.$FunctionKind === "generator") {
        throw realm.createErrorThrowCompletion(realm.intrinsics.TypeError, "superclass cannot be a generator");
      }

      // ii. Let protoParent be Get(superclass, "prototype").
      protoParent = Get(realm, superclass, "prototype");

      // iii. ReturnIfAbrupt(protoParent).

      // iv. If Type(protoParent) is neither Object nor Null, throw a TypeError exception.
      if (!(protoParent instanceof ObjectValue || protoParent instanceof NullValue)) {
        if (protoParent instanceof AbstractValue) {
          let error = new CompilerDiagnostic(
            "unknown super class prototype",
            ClassHeritage.loc,
            "PP0010",
            "RecoverableError"
          );
          if (realm.handleError(error) === "Fail") throw new FatalError();
          protoParent = realm.intrinsics.ObjectPrototype;
        } else {
          throw realm.createErrorThrowCompletion(
            realm.intrinsics.TypeError,
            "protoParent must be an instance of Object or Null"
          );
        }
      }

      // v. Let constructorParent be superclass.
      constructorParent = superclass;
    }
  }

  // 7. Let proto be ObjectCreate(protoParent).
  let proto = Create.ObjectCreate(realm, protoParent);

  // Provide a hint that this prototype is that of a class
  proto.$IsClassPrototype = true;

  let constructor;
  let emptyConstructor = false;
  let ClassBody: Array<BabelNodeClassMethod> = [];
  for (let elem of ast.body.body) {
    if (elem.type === "ClassMethod") {
      ClassBody.push(elem);
    }
  }
  // 8. If ClassBody opt is not present, let constructor be empty.
  if (ClassBody.length === 0) {
    emptyConstructor = true;
    constructor = realm.intrinsics.empty;
  } else {
    // 9. Else, let constructor be ConstructorMethod of ClassBody.
    constructor = ConstructorMethod(realm, ClassBody);
  }
  let explicitConstructorNode = constructor instanceof EmptyValue ? undefined : constructor;

  // 10. If constructor is empty, then,
  if (constructor instanceof EmptyValue) {
    emptyConstructor = true;
    let constructorFile;
    if (ast.superClass) {
      constructorFile = parse(realm, "class NeedClassForParsing { constructor(... args){ super (...args);} }", "");
    } else {
      constructorFile = parse(realm, "class NeedClassForParsing { constructor( ){ } }", "");
    }

    let {
      program: {
        body: [classDeclaration],
      },
    } = constructorFile;
    invariant(classDeclaration.type === "ClassDeclaration");
    let { body } = ((classDeclaration: any): BabelNodeClassDeclaration);
    invariant(body.body[0].type === "ClassMethod");
    constructor = ((body.body[0]: any): BabelNodeClassMethod);
  }

  // 11. Set the running execution context’s LexicalEnvironment to classScope.
  realm.getRunningContext().lexicalEnvironment = classScope;

  let staticFieldInitializers: Array<() => void> = [];
  let instanceElements: Array<ClassInstanceElement> = [];

  try {
    // 12. Let constructorInfo be DefineMethod for constructor with proto and constructorParent.
    let constructorInfo = Functions.DefineMethod(realm, constructor, proto, classScope, true, constructorParent);

    // 14. Let F be constructorInfo.[[closure]]
    F = constructorInfo.$Closure;
    proto.originalConstructor = F;

    // Assign the empty constructor boolean
    F.$HasEmptyConstructor = emptyConstructor;

    // 15. If ClassHeritage opt is present, set F’s [[ConstructorKind]] internal slot to "derived".
    if (ast.superClass) {
      F.$ConstructorKind = "derived";
    }

    // 16. Perform MakeConstructor(F, false, proto).
    MakeConstructor(realm, F, false, proto);

    // 17. Perform MakeClassConstructor(F).
    MakeClassConstructor(realm, F);

    // 18. Perform CreateMethodProperty(proto, "constructor", F).
    Create.CreateMethodProperty(realm, proto, "constructor", F);

    for (let rawElem of ast.body.body) {
      let elem: any = rawElem;
      if (elem === explicitConstructorNode) continue;
      let isStatic = IsStatic(elem);
      let owner = isStatic ? F : proto;

      if (elem.type === "ClassMethod" && elem.key && elem.key.type === "PrivateName") {
        let pName: string = elem.key.id.name;
        let privSym = privateBindings.get(pName);
        invariant(privSym !== undefined);
        let closure;
        if (elem.kind === "get") {
          closure = Functions.FunctionCreate(realm, "method", [], elem.body, classScope, true);
          Functions.MakeMethod(realm, closure, owner);
          Functions.SetFunctionName(realm, closure, "#" + pName, "get");
        } else if (elem.kind === "set") {
          closure = Functions.FunctionCreate(realm, "method", elem.params, elem.body, classScope, true);
          Functions.MakeMethod(realm, closure, owner);
          Functions.SetFunctionName(realm, closure, "#" + pName, "set");
        } else {
          let isGen = elem.generator === true;
          let isAsync = elem.async === true;
          if (isGen && isAsync) {
            closure = Functions.AsyncGeneratorFunctionCreate(realm, "method", elem.params, elem.body, classScope, true);
            Functions.MakeMethod(realm, closure, owner);
            let gProto = Create.ObjectCreate(realm, realm.intrinsics.AsyncGeneratorPrototype);
            gProto.originalConstructor = closure;
            Properties.DefinePropertyOrThrow(
              realm,
              closure,
              "prototype",
              new PropertyDescriptor({ value: gProto, writable: true, enumerable: false, configurable: false })
            );
          } else if (isGen) {
            closure = Functions.GeneratorFunctionCreate(realm, "method", elem.params, elem.body, classScope, true);
            Functions.MakeMethod(realm, closure, owner);
            let gProto = Create.ObjectCreate(realm, realm.intrinsics.GeneratorPrototype);
            gProto.originalConstructor = closure;
            Properties.DefinePropertyOrThrow(
              realm,
              closure,
              "prototype",
              new PropertyDescriptor({ value: gProto, writable: true, enumerable: false, configurable: false })
            );
          } else if (isAsync) {
            closure = Functions.AsyncFunctionCreate(realm, "method", elem.params, elem.body, classScope, true);
            Functions.MakeMethod(realm, closure, owner);
          } else {
            closure = Functions.FunctionCreate(realm, "method", elem.params, elem.body, classScope, true);
            Functions.MakeMethod(realm, closure, owner);
          }
          Functions.SetFunctionName(realm, closure, "#" + pName);
        }
        closure.loc = elem.loc;

        if (isStatic) {
          let existing = F.symbols.get(privSym);
          let existingDesc = existing !== undefined ? existing.descriptor : undefined;
          if (elem.kind === "method") {
            Properties.DefinePropertyOrThrow(
              realm,
              F,
              privSym,
              new PropertyDescriptor({ value: closure, writable: false, enumerable: false, configurable: false })
            );
          } else {
            let prevGet =
              existingDesc instanceof PropertyDescriptor && !(existingDesc.get instanceof UndefinedValue)
                ? existingDesc.get
                : undefined;
            let prevSet =
              existingDesc instanceof PropertyDescriptor && !(existingDesc.set instanceof UndefinedValue)
                ? existingDesc.set
                : undefined;
            Properties.DefinePropertyOrThrow(
              realm,
              F,
              privSym,
              new PropertyDescriptor({
                get: elem.kind === "get" ? closure : prevGet || realm.intrinsics.undefined,
                set: elem.kind === "set" ? closure : prevSet || realm.intrinsics.undefined,
                enumerable: false,
                configurable: true,
              })
            );
          }
        } else {
          instanceElements.push({
            kind: "privateMethod",
            methodKind: elem.kind,
            privateName: pName,
            privateSymbol: privSym,
            func: closure,
          });
        }
      } else if (elem.type === "ClassMethod") {
        Properties.PropertyDefinitionEvaluation(realm, elem, owner, classScope, true, false);
      } else if (elem.type === "ClassProperty" || elem.type === "ClassPrivateProperty") {
        let isPrivate = elem.type === "ClassPrivateProperty";
        let pName: void | string;
        let propKey;
        let computed = false;
        if (isPrivate) {
          pName = elem.key.id.name;
          let privSym = privateBindings.get(pName);
          invariant(privSym !== undefined);
          propKey = privSym;
        } else {
          let rawKey = EvalPropertyName(elem, classScope, realm, true);
          propKey = rawKey instanceof StringValue ? rawKey.value : rawKey;
          computed = !!elem.computed;
        }
        let hasValue = elem.value != null;
        let initBody = hasValue ? t.blockStatement([t.returnStatement(elem.value)]) : t.blockStatement([]);
        if (elem.loc) initBody.loc = elem.loc;
        let initFn = Functions.FunctionCreate(realm, "method", [], initBody, classScope, true);
        Functions.MakeMethod(realm, initFn, owner);
        let setFnName = hasValue && IsAnonymousFunctionDefinition(realm, elem.value) && !computed;

        if (isStatic) {
          let capturedFunc = F;
          staticFieldInitializers.push(() => {
            let initVal = hasValue ? Call(realm, initFn, capturedFunc, []) : realm.intrinsics.undefined;
            if (setFnName && initVal instanceof ObjectValue && !HasOwnProperty(realm, initVal, "name")) {
              Functions.SetFunctionName(realm, initVal, isPrivate && pName !== undefined ? "#" + pName : propKey);
            }
            if (isPrivate) {
              invariant(propKey instanceof SymbolValue);
              Properties.DefinePropertyOrThrow(
                realm,
                capturedFunc,
                propKey,
                new PropertyDescriptor({ value: initVal, writable: true, enumerable: false, configurable: false })
              );
            } else {
              Create.CreateDataPropertyOrThrow(realm, capturedFunc, propKey, initVal);
            }
          });
        } else {
          instanceElements.push({
            kind: "field",
            isPrivate,
            privateName: pName,
            key: propKey,
            computed,
            initializer: initFn,
            hasValue,
            setFunctionName: setFnName,
          });
        }
      }
    }

    if (instanceElements.length > 0) {
      F.$ClassInstanceElements = instanceElements;
    }

    // 23. Initialize className BEFORE running static field initializers so `static x = ClassName.y` resolves ClassName.
    if (className !== undefined) {
      classScopeEnvRec.InitializeBinding(className, F, true);
    }

    for (let runStaticField of staticFieldInitializers) {
      runStaticField();
    }
  } finally {
    // 22. Set the running execution context’s LexicalEnvironment to lex.
    realm.getRunningContext().lexicalEnvironment = lex;
  }

  // Return F.
  return F;
}

// ECMA2 14.5.15
function BindingClassDeclarationEvaluation(
  realm: Realm,
  ast: BabelNodeClassDeclaration,
  strictCode: boolean,
  env: LexicalEnvironment
) {
  // ClassDeclaration : class BindingIdentifier ClassTail
  if (ast.id) {
    // 1. Let className be StringValue of BindingIdentifier.
    let className = ast.id.name;

    // 2. Let value be the result of ClassDefinitionEvaluation of ClassTail with argument className.
    let value = ClassDefinitionEvaluation(realm, ast, className, strictCode, env);

    // 3. ReturnIfAbrupt(value).

    // 4. Let hasNameProperty be HasOwnProperty(value, "name").
    let hasNameProperty = HasOwnProperty(realm, value, "name");

    // 5. ReturnIfAbrupt(hasNameProperty).

    // 6. If hasNameProperty is false, then perform SetFunctionName(value, className).
    if (hasNameProperty === false) {
      Functions.SetFunctionName(realm, value, className);
    }

    // 7. Let env be the running execution context’s LexicalEnvironment.

    // 8. Let status be InitializeBoundName(className, value, env).
    Environment.InitializeBoundName(realm, className, value, env);

    // 9. ReturnIfAbrupt(status).

    // 10. Return value.
    return value;
  } else {
    // ClassDeclaration : class ClassTail
    // 1. Return the result of ClassDefinitionEvaluation of ClassTail with argument undefined.
    return ClassDefinitionEvaluation(realm, ast, undefined, strictCode, env);
  }
}

// ECMA262 14.5.16
export default function(
  ast: BabelNodeClassDeclaration,
  strictCode: boolean,
  env: LexicalEnvironment,
  realm: Realm
): Value {
  // 1. Let status be the result of BindingClassDeclarationEvaluation of this ClassDeclaration.
  BindingClassDeclarationEvaluation(realm, ast, strictCode, env);

  // 2. ReturnIfAbrupt(status).

  // 3. Return NormalCompletion(empty).
  return realm.intrinsics.empty;
}
