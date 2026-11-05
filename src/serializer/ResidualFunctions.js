/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

import { CompilerDiagnostic, FatalError } from "../errors.js";
import { Realm } from "../realm.js";
import { FunctionValue, ECMAScriptSourceFunctionValue, ObjectValue, Value } from "../values/index.js";
import type { SerializerOptions } from "../options.js";
import * as t from "@babel/types";
import type {
  BabelNodeCallExpression,
  BabelNodeClassMethod,
  BabelNodeClassExpression,
  BabelNodeExpression,
  BabelNodeStatement,
  BabelNodeIdentifier,
  BabelNodeBlockStatement,
  BabelNodeLVal,
  BabelNodeSpreadElement,
  BabelNodeFunctionExpression,
  BabelNodeArrowFunctionExpression,
  BabelNodeVariableDeclarator,
} from "@babel/types";
import traverseFast from "../utils/traverse-fast.js";
import type { FunctionBodyAstNode } from "../types.js";
import type { NameGenerator } from "../utils/NameGenerator.js";
import invariant from "../invariant.js";
import type {
  ResidualFunctionBinding,
  FunctionInfo,
  FactoryFunctionInfo,
  FunctionInstance,
  AdditionalFunctionInfo,
} from "./types.js";
import { BodyReference, AreSameResidualBinding } from "./types.js";
import { SerializerStatistics } from "./statistics.js";
import { ResidualFunctionInstantiator, type Replacement, getReplacement } from "./ResidualFunctionInstantiator.js";
import { Modules } from "../utils/modules.js";
import { ResidualFunctionInitializers } from "./ResidualFunctionInitializers.js";
import { nullExpression } from "../utils/babelhelpers.js";
import type { LocationService, ClassMethodInstance, SerializedBody } from "./types.js";
import { Referentializer } from "./Referentializer.js";
import { HeapInspector } from "../utils/HeapInspector.js";
import { getOrDefault } from "./utils.js";

type ResidualFunctionsResult = {
  unstrictFunctionBodies: Array<BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression>,
  strictFunctionBodies: Array<BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression>,
  strictFunctionDeclarators: Array<BabelNodeVariableDeclarator>,
};

export class ResidualFunctions {
  constructor(
    realm: Realm,
    options: SerializerOptions,
    modules: Modules,
    requireReturns: Map<number | string, Replacement>,
    locationService: LocationService,
    prelude: Array<BabelNodeStatement>,
    factoryNameGenerator: NameGenerator,
    residualFunctionInfos: Map<BabelNodeBlockStatement, FunctionInfo>,
    residualFunctionInstances: Map<FunctionValue, FunctionInstance>,
    residualClassMethodInstances: Map<FunctionValue, ClassMethodInstance>,
    additionalFunctionValueInfos: Map<FunctionValue, AdditionalFunctionInfo>,
    additionalFunctionValueNestedFunctions: Set<FunctionValue>,
    referentializer: Referentializer,
    embeddedFunctionNames?: Map<FunctionValue, string>
  ) {
    this.realm = realm;
    this.modules = modules;
    this.requireReturns = requireReturns;
    this.locationService = locationService;
    this.prelude = prelude;
    this.factoryNameGenerator = factoryNameGenerator;
    this.functionPrototypes = new Map();
    this.firstFunctionUsages = new Map();
    this.firstFunctionUsagesPerBody = new Map();
    this.functions = new Map();
    this.classes = new Map();
    this.functionInstances = [];
    this.residualFunctionInitializers = new ResidualFunctionInitializers(locationService);
    this.residualFunctionInfos = residualFunctionInfos;
    this.residualFunctionInstances = residualFunctionInstances;
    this.residualClassMethodInstances = residualClassMethodInstances;
    this.additionalFunctionValueInfos = additionalFunctionValueInfos;
    this.referentializer = referentializer;
    this.embeddedFunctionNames = embeddedFunctionNames || new Map();
    for (let instance of residualFunctionInstances.values()) {
      invariant(instance !== undefined);
      if (!additionalFunctionValueInfos.has(instance.functionValue)) this.addFunctionInstance(instance);
    }
    this.additionalFunctionValueNestedFunctions = additionalFunctionValueNestedFunctions;
    this.additionalFunctionPreludes = new Map();
    for (let functionValue of additionalFunctionValueInfos.keys()) {
      this.additionalFunctionPreludes.set(functionValue, []);
    }
  }

  realm: Realm;
  modules: Modules;
  requireReturns: Map<number | string, Replacement>;
  locationService: LocationService;
  prelude: Array<BabelNodeStatement>;
  factoryNameGenerator: NameGenerator;
  functionPrototypes: Map<FunctionValue, BabelNodeIdentifier>;
  firstFunctionUsages: Map<FunctionValue, BodyReference>;
  firstFunctionUsagesPerBody: Map<FunctionValue, Map<SerializedBody, BodyReference>>;
  functions: Map<BabelNodeBlockStatement, Array<FunctionInstance>>;
  classes: Map<ObjectValue, BabelNodeClassExpression>;
  functionInstances: Array<FunctionInstance>;
  residualFunctionInitializers: ResidualFunctionInitializers;
  residualFunctionInfos: Map<BabelNodeBlockStatement, FunctionInfo>;
  residualFunctionInstances: Map<FunctionValue, FunctionInstance>;
  residualClassMethodInstances: Map<FunctionValue, ClassMethodInstance>;
  additionalFunctionValueInfos: Map<FunctionValue, AdditionalFunctionInfo>;
  additionalFunctionValueNestedFunctions: Set<FunctionValue>;
  referentializer: Referentializer;
  embeddedFunctionNames: Map<FunctionValue, string>;
  additionalFunctionPreludes: Map<FunctionValue, Array<BabelNodeStatement>>;

  getStatistics(): SerializerStatistics {
    invariant(this.realm.statistics instanceof SerializerStatistics, "serialization requires SerializerStatistics");
    return this.realm.statistics;
  }

  addFunctionInstance(instance: FunctionInstance): void {
    this.functionInstances.push(instance);
    let code = instance.functionValue.$ECMAScriptCode;
    invariant(code != null);
    getOrDefault(this.functions, code, () => []).push(instance);
  }

  setFunctionPrototype(constructor: FunctionValue, prototypeId: BabelNodeIdentifier): void {
    this.functionPrototypes.set(constructor, prototypeId);
  }

  addFunctionUsage(val: FunctionValue, bodyReference: BodyReference): void {
    if (!this.firstFunctionUsages.has(val)) this.firstFunctionUsages.set(val, bodyReference);
    let byBody = this.firstFunctionUsagesPerBody.get(val);
    if (byBody === undefined) {
      byBody = new Map();
      this.firstFunctionUsagesPerBody.set(val, byBody);
    }
    let prev = byBody.get(bodyReference.body);
    if (prev === undefined || bodyReference.index < prev.index) {
      byBody.set(bodyReference.body, bodyReference);
    }
  }

  _findSelfBindingName(funcBody: BabelNodeBlockStatement, instances: Array<FunctionInstance>): void | string {
    if (instances.length === 0 || instances[0].functionValue.$ThisMode === "lexical") return undefined;
    let functionInfo = this.residualFunctionInfos.get(funcBody);
    invariant(functionInfo);
    let selfName;
    for (let name of functionInfo.unbound.keys()) {
      let allSelf = true;
      for (let inst of instances) {
        let rb = inst.residualFunctionBindings.get(name);
        if (!rb || rb.modified || rb.value !== inst.functionValue) {
          allSelf = false;
          break;
        }
      }
      if (allSelf) {
        if (selfName !== undefined) return undefined;
        selfName = name;
      }
    }
    return selfName;
  }

  _canArrowGoToPrelude(val: FunctionValue): boolean {
    if (!(val instanceof ECMAScriptSourceFunctionValue)) return false;
    let code = val.$ECMAScriptCode;
    let fInfo = code ? this.residualFunctionInfos.get(code) : undefined;
    return fInfo === undefined || (!fInfo.usesThis && !fInfo.usesArguments);
  }

  _isStaticallyInPrelude(val: FunctionValue): boolean {
    if (!(val instanceof ECMAScriptSourceFunctionValue)) return false;
    if (val.isIntrinsic()) return false;
    if (val.$ThisMode === "lexical" && !this._canArrowGoToPrelude(val)) return false;
    if (this.residualClassMethodInstances.has(val)) return false;
    if (this.additionalFunctionValueNestedFunctions.has(val)) return false;
    let inst = this.residualFunctionInstances.get(val);
    if (inst === undefined || inst.containingAdditionalFunction !== undefined) return false;
    return true;
  }

  _isPreludeSafeArg(val: void | Value, inPreludeFunctions?: Set<FunctionValue>): boolean {
    if (val === undefined) return false;
    if (HeapInspector.isLeaf(val)) return true;
    if (val instanceof FunctionValue) {
      if (inPreludeFunctions !== undefined) return inPreludeFunctions.has(val);
      return this._isStaticallyInPrelude(val);
    }
    return false;
  }

  _partitionCurriedInstances(
    funcBody: BabelNodeBlockStatement,
    instances: Array<FunctionInstance>
  ): Array<FunctionInstance> {
    if (instances.length <= 1) return [];
    if (instances[0].functionValue.$FunctionKind !== "normal") return [];
    if (this.residualClassMethodInstances.has(instances[0].functionValue)) return [];
    if (instances[0].scopeInstances.size > 0) return [];
    let functionInfo = this.residualFunctionInfos.get(funcBody);
    invariant(functionInfo);
    let { unbound, modified, usesThis, usesArguments } = functionInfo;
    let params = instances[0].functionValue.$FormalParameters;
    let hasNonIdentifierParam = params !== undefined && params.some(p => p.type !== "Identifier");
    if (unbound.size === 0 && modified.size === 0 && !usesThis && !usesArguments && !hasNonIdentifierParam) {
      return [];
    }

    for (let name of unbound.keys()) {
      let firstBinding = instances[0].residualFunctionBindings.get(name);
      if (!firstBinding) return [];
      if (firstBinding.declarativeEnvironmentRecord === null && firstBinding.value === undefined) continue;
      if (firstBinding.modified) return [];
      for (let k = 1; k < instances.length; k++) {
        let rb = instances[k].residualFunctionBindings.get(name);
        if (!rb) return [];
        if (rb.declarativeEnvironmentRecord === null && rb.value === undefined) continue;
        if (rb.modified) return [];
      }
    }

    const canReachViaGroup = (startFv: FunctionValue, targetFv: FunctionValue): boolean => {
      let stack: Array<FunctionValue> = [startFv];
      let visited: Set<FunctionValue> = new Set([startFv]);
      while (stack.length > 0) {
        let cur = stack.pop();
        if (!cur) continue;
        if (cur === targetFv) return true;
        let curInst = this.residualFunctionInstances.get(cur);
        if (!curInst || this.additionalFunctionValueInfos.has(cur)) continue;
        if (!(cur instanceof ECMAScriptSourceFunctionValue)) continue;
        let curCode = cur.$ECMAScriptCode;
        let curGroup = curCode ? this.functions.get(curCode) : undefined;
        if (!curGroup || curGroup.length <= 1) continue;
        for (let bVal of curInst.residualFunctionBindings.values()) {
          let nextVal = bVal.value;
          if (nextVal instanceof FunctionValue && nextVal !== cur && !visited.has(nextVal)) {
            visited.add(nextVal);
            stack.push(nextVal);
          }
        }
      }
      return false;
    };

    let eligible = [];
    for (let inst of instances) {
      let fv = inst.functionValue;
      if (fv.$FunctionKind !== "normal" || fv.$HomeObject !== undefined) continue;
      if (inst.containingAdditionalFunction !== undefined) continue;
      if (this.additionalFunctionValueNestedFunctions.has(fv)) continue;
      if (this.residualClassMethodInstances.has(fv)) continue;
      if (this.residualFunctionInitializers.hasInitializerStatement(fv)) continue;
      if (this.embeddedFunctionNames.has(fv)) continue;
      if (this.functionPrototypes.get(fv) !== undefined) continue;
      let insertionPoint = inst.insertionPoint;
      if (insertionPoint === undefined) continue;

      let canGoToPrelude = true;
      let ok = true;
      for (let [, rb] of inst.residualFunctionBindings) {
        if (rb.value === fv) continue;
        if (rb.declarativeEnvironmentRecord === null && rb.value === undefined) continue;
        if (rb.referentialized || rb.serializedValue === undefined) {
          ok = false;
          break;
        }
        if (!this._isPreludeSafeArg(rb.value)) {
          canGoToPrelude = false;
        }
        if (rb.value instanceof FunctionValue && canReachViaGroup(rb.value, fv)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (!canGoToPrelude) {
        let firstUsage = this.firstFunctionUsages.get(fv);
        if (firstUsage !== undefined && !firstUsage.isNotEarlierThan(insertionPoint)) continue;
        let depBeforeOk = true;
        for (let [, rb] of inst.residualFunctionBindings) {
          let rbVal = rb.value;
          if (rbVal instanceof ECMAScriptSourceFunctionValue && rbVal !== fv) {
            let depInst = this.residualFunctionInstances.get(rbVal);
            if (depInst !== undefined && !this.additionalFunctionValueInfos.has(rbVal)) {
              let depCode = rbVal.$ECMAScriptCode;
              let depGroup = depCode ? this.functions.get(depCode) : undefined;
              if (depGroup !== undefined && depGroup.length > 1) {
                let depPoint = depInst.insertionPoint;
                if (
                  depPoint === undefined ||
                  depPoint.body !== insertionPoint.body ||
                  depPoint.index > insertionPoint.index
                ) {
                  depBeforeOk = false;
                  break;
                }
              }
            }
          }
        }
        if (!depBeforeOk) continue;
      }
      eligible.push(inst);
    }
    return eligible.length >= 2 ? eligible : [];
  }

  _canUseCurriedFactory(funcBody: BabelNodeBlockStatement, instances: Array<FunctionInstance>): boolean {
    return this._partitionCurriedInstances(funcBody, instances).length >= 2;
  }

  _shouldUseFactoryFunction(funcBody: BabelNodeBlockStatement, instances: Array<FunctionInstance>): boolean {
    invariant(instances.length > 0);
    if (instances.length <= 1) return false;
    for (const instance of instances) {
      if (
        this.residualClassMethodInstances.has(instance.functionValue) ||
        instance.functionValue.$HomeObject !== undefined ||
        instance.functionValue.$FunctionKind !== "normal"
      ) {
        return false;
      }
    }
    let hasAnyLeakedIds = false;
    for (const instance of instances)
      for (const scope of instance.scopeInstances.values()) if (scope.leakedIds.length > 0) hasAnyLeakedIds = true;
    if (hasAnyLeakedIds) return false;

    let functionInfo = this.residualFunctionInfos.get(funcBody);
    invariant(functionInfo);
    let { usesArguments } = functionInfo;
    let params = instances[0].functionValue.$FormalParameters;
    let hasNonIdentifierParam = params !== undefined && params.some(p => p.type !== "Identifier");
    let canCurry = this._canUseCurriedFactory(funcBody, instances);
    if ((usesArguments || hasNonIdentifierParam) && !canCurry) return false;

    if (instances[0].scopeInstances.size > 0) return true;
    if (funcBody.start && funcBody.end) {
      let bodySize = funcBody.end - funcBody.start;
      let minSize = canCurry && instances.length >= 4 ? 15 : 30;
      if (bodySize <= minSize) return false;
    } else {
      return false;
    }
    return true;
  }

  _getIdentifierReplacements(
    funcBody: BabelNodeBlockStatement,
    residualFunctionBindings: Map<string, ResidualFunctionBinding>
  ): Map<BabelNodeIdentifier, Replacement> {
    let functionInfo = this.residualFunctionInfos.get(funcBody);
    invariant(functionInfo);
    let { unbound } = functionInfo;
    let res = new Map();
    for (let [name, nodes] of unbound) {
      let residualFunctionBinding = residualFunctionBindings.get(name);
      if (residualFunctionBinding === undefined) continue;

      // Let's skip bindings that are referring to
      // 1) something global (without an environment record), and
      // 2) have not been assigned a value (which would mean that they have a var/let binding and Prepack will take the liberty to rename them).
      if (
        residualFunctionBinding.declarativeEnvironmentRecord === null &&
        residualFunctionBinding.value === undefined
      ) {
        continue;
      }

      let serializedValue = residualFunctionBinding.serializedValue;
      invariant(serializedValue !== undefined);
      let replacement = getReplacement(
        serializedValue,
        residualFunctionBinding.referentialized ? undefined : residualFunctionBinding.value
      );
      for (let node of nodes) res.set(node, replacement);
    }
    return res;
  }

  _getCallReplacements(funcBody: BabelNodeBlockStatement): Map<BabelNode, Replacement> {
    let functionInfo = this.residualFunctionInfos.get(funcBody);
    invariant(functionInfo);
    let { requireCalls, modified } = functionInfo;
    let res = new Map();
    for (let [callNode, moduleId] of requireCalls) {
      this.getStatistics().requireCalls++;
      if (modified.has(callNode.callee.name)) continue;

      let replacement = this.requireReturns.get("" + moduleId);
      if (replacement !== undefined) {
        this.getStatistics().requireCallsReplaced++;
        res.set(callNode, replacement);
      }
    }
    return res;
  }

  // Note: this function takes linear time. Please do not call it inside loop.
  _hasRewrittenFunctionInstance(
    rewrittenAdditionalFunctions: Map<FunctionValue, Array<BabelNodeStatement>>,
    instances: Array<FunctionInstance>
  ): boolean {
    return instances.find(instance => rewrittenAdditionalFunctions.has(instance.functionValue)) !== undefined;
  }

  _generateFactoryFunctionInfos(
    rewrittenAdditionalFunctions: Map<FunctionValue, Array<BabelNodeStatement>>
  ): Map<number, FactoryFunctionInfo> {
    const factoryFunctionInfos = new Map();
    for (const [functionBody, instances] of this.functions) {
      invariant(instances.length > 0);

      let factoryId;
      let suffix = instances[0].functionValue.__originalName || this.realm.debugNames ? "factoryFunction" : "";
      let isCurried = false;
      if (this._shouldUseFactoryFunction(functionBody, instances)) {
        // Rewritten function should never use factory function.
        invariant(!this._hasRewrittenFunctionInstance(rewrittenAdditionalFunctions, instances));
        factoryId = t.identifier(this.factoryNameGenerator.generate(suffix));
        isCurried = this._canUseCurriedFactory(functionBody, instances);
      } else {
        // For inline function body case, use the first function as the factory function.
        factoryId = this.locationService.getLocation(instances[0].functionValue);
      }

      const functionUniqueTag = ((functionBody: any): FunctionBodyAstNode).uniqueOrderedTag;
      invariant(functionUniqueTag);

      const functionInfo = this.residualFunctionInfos.get(functionBody);
      invariant(functionInfo);
      let anyContainingAdditionalFunction = !instances.every(
        instance => instance.containingAdditionalFunction === undefined
      );
      factoryFunctionInfos.set(functionUniqueTag, {
        factoryId,
        functionInfo,
        anyContainingAdditionalFunction,
        isCurried,
      });
    }
    return factoryFunctionInfos;
  }

  // Preserve residual functions' ordering based on its ast dfs traversal order.
  // This is necessary to prevent unexpected code locality issues.
  _sortFunctionByOriginalOrdering(functionEntries: Array<[BabelNodeBlockStatement, Array<FunctionInstance>]>): void {
    functionEntries.sort((funcA, funcB) => {
      const funcAUniqueTag = ((funcA[0]: any): FunctionBodyAstNode).uniqueOrderedTag;
      invariant(funcAUniqueTag);

      const funcBUniqueTag = ((funcB[0]: any): FunctionBodyAstNode).uniqueOrderedTag;
      invariant(funcBUniqueTag);
      return funcAUniqueTag - funcBUniqueTag;
    });
  }

  _createFunctionExpression(
    params: Array<BabelNodeLVal>,
    body: BabelNodeBlockStatement,
    isLexical: boolean,
    isGenerator: boolean = false,
    isAsync: boolean = false
  ): BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression {
    // Additional statements might be inserted at the beginning of the body, so we clone it.
    body = ((Object.assign({}, body): any): BabelNodeBlockStatement);
    return isLexical
      ? t.arrowFunctionExpression(params, body, isAsync)
      : t.functionExpression(null, params, body, isGenerator, isAsync);
  }

  spliceFunctions(
    rewrittenAdditionalFunctions: Map<FunctionValue, Array<BabelNodeStatement>>
  ): ResidualFunctionsResult {
    this.residualFunctionInitializers.scrubFunctionInitializers();

    let functionBodies = new Map();
    // these need to get spliced in at the end
    let additionalFunctionModifiedBindingsSegment: Map<FunctionValue, Array<BabelNodeStatement>> = new Map();
    let getModifiedBindingsSegment = additionalFunction =>
      getOrDefault(additionalFunctionModifiedBindingsSegment, additionalFunction, () => []);
    let getFunctionBody = (instance: FunctionInstance): Array<BabelNodeStatement> =>
      getOrDefault(functionBodies, instance, () => []);
    let getPrelude = (instance: FunctionInstance): Array<BabelNodeStatement> => {
      let additionalFunction = instance.containingAdditionalFunction;
      let b;
      if (additionalFunction !== undefined) {
        b = this.additionalFunctionPreludes.get(additionalFunction);
        invariant(b !== undefined);
      } else {
        b = this.prelude;
      }
      return b;
    };

    let functionEntries: Array<[BabelNodeBlockStatement, Array<FunctionInstance>]> = Array.from(
      this.functions.entries()
    );
    this._sortFunctionByOriginalOrdering(functionEntries);
    this.getStatistics().functions = functionEntries.length;
    let unstrictFunctionBodies: Array<BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression> = [];
    let strictFunctionBodies: Array<BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression> = [];
    let strictFunctionDeclarators: Array<BabelNodeVariableDeclarator> = [];
    let registerFunctionStrictness = (
      node:
        | BabelNodeFunctionExpression
        | BabelNodeArrowFunctionExpression
        | BabelNodeClassMethod
        | BabelNodeClassExpression,
      strict: boolean,
      declarator?: BabelNodeVariableDeclarator
    ) => {
      if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
        (strict ? strictFunctionBodies : unstrictFunctionBodies).push(
          ((node: any): BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression)
        );
        if (strict && declarator !== undefined) {
          strictFunctionDeclarators.push(declarator);
        }
      }
    };
    let preludeCurriedInstances: Map<
      FunctionInstance,
      {
        functionId: BabelNodeIdentifier,
        funcNode: BabelNodeCallExpression,
        params: Array<BabelNodeLVal>,
        funcBody: BabelNodeBlockStatement,
        sameResidualBindings: Map<string, ResidualFunctionBinding>,
      }
    > = new Map();
    let funcNodes: Map<
      FunctionValue,
      BabelNodeFunctionExpression | BabelNodeArrowFunctionExpression | BabelNodeClassMethod
    > = new Map();
    let preludeDefinedFuncs: Set<FunctionValue> = new Set();
    let defineFunction = (
      instance: FunctionInstance,
      funcId: BabelNodeIdentifier,
      funcOrClassNode:
        | BabelNodeCallExpression
        | BabelNodeFunctionExpression
        | BabelNodeArrowFunctionExpression
        | BabelNodeClassExpression
    ): BabelNodeVariableDeclarator => {
      let { functionValue } = instance;

      if (instance.initializationStatements.length > 0) {
        // always add initialization statements to insertion point
        let initializationBody = getFunctionBody(instance);
        Array.prototype.push.apply(initializationBody, instance.initializationStatements);
      }

      let body;
      if (t.isFunctionExpression(funcOrClassNode)) {
        funcNodes.set(functionValue, ((funcOrClassNode: any): BabelNodeFunctionExpression));
        if (instance.containingAdditionalFunction === undefined) {
          preludeDefinedFuncs.add(functionValue);
        }
        body = getPrelude(instance);
      } else if (t.isArrowFunctionExpression(funcOrClassNode) && this._canArrowGoToPrelude(functionValue)) {
        funcNodes.set(functionValue, ((funcOrClassNode: any): BabelNodeArrowFunctionExpression));
        if (instance.containingAdditionalFunction === undefined) {
          preludeDefinedFuncs.add(functionValue);
        }
        body = getPrelude(instance);
      } else {
        invariant(
          t.isCallExpression(funcOrClassNode) ||
            t.isClassExpression(funcOrClassNode) ||
            t.isArrowFunctionExpression(funcOrClassNode)
        ); // .bind call
        if (t.isArrowFunctionExpression(funcOrClassNode)) {
          funcNodes.set(functionValue, ((funcOrClassNode: any): BabelNodeArrowFunctionExpression));
        }
        body = getFunctionBody(instance);
      }
      let declarator = t.variableDeclarator(funcId, funcOrClassNode);
      body.push(t.variableDeclaration("var", [declarator]));
      let prototypeId = this.functionPrototypes.get(functionValue);
      if (prototypeId !== undefined) {
        let id = this.locationService.getLocation(functionValue);
        invariant(id !== undefined);
        body.push(
          t.variableDeclaration("var", [
            t.variableDeclarator(prototypeId, t.memberExpression(id, t.identifier("prototype"))),
          ])
        );
      }
      return declarator;
    };

    // Emit code for ModifiedBindings for additional functions
    for (let [funcValue, funcInfo] of this.additionalFunctionValueInfos) {
      let scopes = new Set();
      for (let [, residualBinding] of funcInfo.modifiedBindings) {
        let scope = residualBinding.scope;
        if (scope === undefined || scopes.has(scope)) continue;
        scopes.add(scope);

        invariant(residualBinding.referentialized);

        // Find the proper prelude to emit to (global vs additional function's prelude)
        let bodySegment = getModifiedBindingsSegment(funcValue);

        // binding has been referentialized, so setup the scope to be able to
        // access bindings from other __captured_scopes initializers
        if (scope.referentializationScope !== funcValue) {
          let init = this.referentializer.getReferentializedScopeInitialization(scope, t.numericLiteral(scope.id));
          // flow forces me to do this
          Array.prototype.push.apply(bodySegment, init);
        }
      }
    }

    // Process Additional Functions
    for (let [funcValue, additionalFunctionInfo] of this.additionalFunctionValueInfos.entries()) {
      let { instance } = additionalFunctionInfo;
      let functionValue = ((funcValue: any): ECMAScriptSourceFunctionValue);
      let params = functionValue.$FormalParameters;
      let isLexical = functionValue.$ThisMode === "lexical";
      let fKind = functionValue.$FunctionKind;
      let isGenerator = fKind === "generator" || fKind === "asyncGenerator";
      let isAsync = fKind === "async" || fKind === "asyncGenerator";
      invariant(params !== undefined);

      let rewrittenBody = rewrittenAdditionalFunctions.get(funcValue);
      invariant(rewrittenBody);

      // rewritten functions shouldn't have references fixed up because the body,
      // consists of serialized code. For simplicity we emit their instances in a naive way
      let functionBody = t.blockStatement(rewrittenBody);
      let funcOrClassNode;

      if (this.residualClassMethodInstances.has(funcValue)) {
        let classMethodInstance = this.residualClassMethodInstances.get(funcValue);
        invariant(classMethodInstance);
        let {
          methodType,
          classMethodKeyNode,
          classSuperNode,
          classMethodComputed,
          classPrototype,
          classMethodIsStatic,
        } = classMethodInstance;

        let isConstructor = methodType === "constructor";
        invariant(methodType !== "field" && methodType !== "privateField");
        invariant(classPrototype instanceof ObjectValue);
        invariant(classMethodKeyNode && (t.isExpression(classMethodKeyNode) || t.isIdentifier(classMethodKeyNode)));
        // we use the classPrototype as the key to get the class expression ast node
        funcOrClassNode = this._getOrCreateClassNode(classPrototype);
        let classMethod = t.classMethod(
          methodType,
          classMethodKeyNode,
          params,
          functionBody,
          classMethodComputed,
          classMethodIsStatic
        );
        if (classMethodInstance.privateName !== undefined) {
          (classMethod: any).key = (t: any).privateName(t.identifier(classMethodInstance.privateName));
          classMethod.computed = false;
        }
        if (isGenerator) classMethod.generator = true;
        if (isAsync) classMethod.async = true;
        funcNodes.set(funcValue, classMethod);
        // add the class method to the class expression node body
        if (isConstructor) {
          funcOrClassNode.body.body.unshift(classMethod);
        } else {
          funcOrClassNode.body.body.push(classMethod);
        }
        // we only return the funcOrClassNode if this is the constructor
        if (!isConstructor) {
          continue;
        }
        // handle the class super
        if (classSuperNode !== undefined) {
          funcOrClassNode.superClass = classSuperNode;
        }
      } else {
        funcOrClassNode = isLexical
          ? t.arrowFunctionExpression(params, functionBody, isAsync)
          : t.functionExpression(null, params, functionBody, isGenerator, isAsync);
      }
      let id = this.locationService.getLocation(funcValue);
      invariant(id !== undefined);

      let declarator = defineFunction(instance, id, funcOrClassNode);
      registerFunctionStrictness(
        funcOrClassNode,
        funcValue instanceof ECMAScriptSourceFunctionValue && funcValue.$Strict,
        declarator
      );
    }

    // Process normal functions
    const factoryFunctionInfos = this._generateFactoryFunctionInfos(rewrittenAdditionalFunctions);
    for (let [funcBody, instances] of functionEntries) {
      let functionInfo = this.residualFunctionInfos.get(funcBody);
      invariant(functionInfo);
      let { unbound, usesThis } = functionInfo;
      let params = instances[0].functionValue.$FormalParameters;
      invariant(params !== undefined);

      // Split instances into normal or nested in an additional function
      let normalInstances = [];
      let additionalFunctionNestedInstances = [];
      for (let instance of instances) {
        if (this.additionalFunctionValueNestedFunctions.has(instance.functionValue))
          additionalFunctionNestedInstances.push(instance);
        else normalInstances.push(instance);
      }

      let naiveProcessInstances = instancesToSplice => {
        this.getStatistics().functionClones += instancesToSplice.length;

        for (let instance of instancesToSplice) {
          let { functionValue, residualFunctionBindings, scopeInstances } = instance;
          let fKind = functionValue.$FunctionKind;
          let isGenerator = fKind === "generator" || fKind === "asyncGenerator";
          let isAsync = fKind === "async" || fKind === "asyncGenerator";
          let funcOrClassNode;

          if (this.residualClassMethodInstances.has(functionValue)) {
            let classMethodInstance = this.residualClassMethodInstances.get(functionValue);
            invariant(classMethodInstance);
            let {
              classSuperNode,
              classMethodKeyNode,
              methodType,
              classMethodComputed,
              classPrototype,
              classMethodIsStatic,
            } = classMethodInstance;

            let isConstructor = methodType === "constructor";
            invariant(classPrototype instanceof ObjectValue);
            invariant(classMethodKeyNode);
            invariant(t.isExpression(classMethodKeyNode) || t.isIdentifier(classMethodKeyNode));
            // we use the classPrototype as the key to get the class expression ast node
            funcOrClassNode = this._getOrCreateClassNode(classPrototype);

            if (methodType === "field" || methodType === "privateField") {
              let instantiatedFn = new ResidualFunctionInstantiator(
                factoryFunctionInfos,
                this.realm.moduleFactoryFunctionsToRemove,
                this._getIdentifierReplacements(funcBody, residualFunctionBindings),
                this._getCallReplacements(funcBody),
                this._createFunctionExpression([], funcBody, false)
              ).instantiate();
              let scopeInitialization = [];
              let delayedInitStmt = this.residualFunctionInitializers.getInitializerStatement(functionValue);
              if (delayedInitStmt !== undefined) {
                scopeInitialization.push(delayedInitStmt);
              }
              for (let scope of scopeInstances.values()) {
                scopeInitialization = scopeInitialization.concat(
                  this.referentializer.getReferentializedScopeInitialization(scope, t.numericLiteral(scope.id))
                );
              }
              let instBody: BabelNodeBlockStatement = ((instantiatedFn.body: any): BabelNodeBlockStatement);
              let valNode = null;
              if (instBody.body.length > 0) {
                if (
                  scopeInitialization.length === 0 &&
                  instBody.body.length === 1 &&
                  t.isReturnStatement(instBody.body[0])
                ) {
                  let retStmt: any = instBody.body[0];
                  valNode = retStmt.argument || null;
                } else {
                  let fullBody = t.blockStatement(scopeInitialization.concat(instBody.body), instBody.directives);
                  valNode = t.callExpression(t.arrowFunctionExpression([], fullBody), []);
                }
              }
              let fieldNode;
              if (methodType === "privateField") {
                invariant(classMethodInstance.privateName !== undefined);
                fieldNode = (t: any).classPrivateProperty(
                  (t: any).privateName(t.identifier(classMethodInstance.privateName)),
                  valNode
                );
              } else {
                fieldNode = t.classProperty(classMethodKeyNode, valNode, null, null, classMethodComputed);
              }
              (funcOrClassNode.body.body: Array<any>).push(fieldNode);
              continue;
            }

            // if we are dealing with a constructor, don't serialize it if the original
            // had an empty user-land constructor (because we create a constructor behind the scenes for them)
            let hasEmptyConstructor = !!functionValue.$HasEmptyConstructor;
            if (!isConstructor || (isConstructor && !hasEmptyConstructor)) {
              let methodParams = params.slice();
              let rawClassMethod = t.classMethod(
                methodType,
                classMethodKeyNode,
                methodParams,
                funcBody,
                classMethodComputed,
                classMethodIsStatic
              );
              if (classMethodInstance.privateName !== undefined) {
                (rawClassMethod: any).key = (t: any).privateName(t.identifier(classMethodInstance.privateName));
                rawClassMethod.computed = false;
              }
              if (isGenerator) rawClassMethod.generator = true;
              if (isAsync) rawClassMethod.async = true;
              let classMethod = new ResidualFunctionInstantiator(
                factoryFunctionInfos,
                this.realm.moduleFactoryFunctionsToRemove,
                this._getIdentifierReplacements(funcBody, residualFunctionBindings),
                this._getCallReplacements(funcBody),
                rawClassMethod
              ).instantiate();

              let scopeInitialization = [];
              for (let scope of scopeInstances.values()) {
                scopeInitialization = scopeInitialization.concat(
                  this.referentializer.getReferentializedScopeInitialization(scope, t.numericLiteral(scope.id))
                );
              }
              if (scopeInitialization.length > 0) {
                classMethod.body = t.blockStatement(
                  scopeInitialization.concat(classMethod.body.body),
                  classMethod.body.directives
                );
              }

              // add the class method to the class expression node body
              funcNodes.set(functionValue, classMethod);
              if (isConstructor) {
                funcOrClassNode.body.body.unshift(classMethod);
              } else {
                funcOrClassNode.body.body.push(classMethod);
              }
            }
            // we only return the funcOrClassNode if this is the constructor
            if (!isConstructor) {
              continue;
            }
            if (classMethodInstance.staticPrivateFields !== undefined) {
              for (let spf of classMethodInstance.staticPrivateFields) {
                let spfNode = (t: any).classPrivateProperty(
                  (t: any).privateName(t.identifier(spf.privateName)),
                  spf.valueNode
                );
                spfNode.static = true;
                (funcOrClassNode.body.body: Array<any>).push(spfNode);
              }
            }
            // handle the class super
            if (classSuperNode !== undefined) {
              funcOrClassNode.superClass = classSuperNode;
            }
          } else {
            if (functionValue.$HomeObject !== undefined) {
              let usesSuper = false;
              let checkSuper = node => {
                if (node.type === "Super") {
                  usesSuper = true;
                  return true;
                }
                return (
                  node.type === "ClassExpression" ||
                  node.type === "ClassDeclaration" ||
                  node.type === "ObjectMethod" ||
                  node.type === "FunctionExpression" ||
                  node.type === "FunctionDeclaration"
                );
              };
              for (let p of params) traverseFast(p, checkSuper);
              if (!usesSuper) traverseFast(funcBody, checkSuper);
              if (usesSuper) {
                let error = new CompilerDiagnostic(
                  "a detached method using super cannot be serialized outside a class or object literal",
                  funcBody.loc,
                  "PP0022",
                  "FatalError"
                );
                this.realm.handleError(error);
                throw new FatalError();
              }
            }
            let isLexical = instance.functionValue.$ThisMode === "lexical";
            funcOrClassNode = new ResidualFunctionInstantiator(
              factoryFunctionInfos,
              this.realm.moduleFactoryFunctionsToRemove,
              this._getIdentifierReplacements(funcBody, residualFunctionBindings),
              this._getCallReplacements(funcBody),
              this._createFunctionExpression(params, funcBody, isLexical, isGenerator, isAsync)
            ).instantiate();

            let scopeInitialization = [];
            for (let scope of scopeInstances.values()) {
              scopeInitialization = scopeInitialization.concat(
                this.referentializer.getReferentializedScopeInitialization(scope, t.numericLiteral(scope.id))
              );
            }

            if (scopeInitialization.length > 0) {
              let funcOrClassNodeBody = ((funcOrClassNode.body: any): BabelNodeBlockStatement);
              invariant(t.isBlockStatement(funcOrClassNodeBody));
              funcOrClassNodeBody.body = scopeInitialization.concat(funcOrClassNodeBody.body);
            }
          }
          let id = this.locationService.getLocation(functionValue);
          invariant(id !== undefined);
          let embeddedName = this.embeddedFunctionNames.get(functionValue);
          if (embeddedName !== undefined && t.isFunctionExpression(funcOrClassNode)) {
            ((funcOrClassNode: any): BabelNodeFunctionExpression).id = t.identifier(embeddedName);
          }

          invariant(id !== undefined);
          invariant(funcOrClassNode !== undefined);
          let declarator = defineFunction(instance, id, funcOrClassNode);
          registerFunctionStrictness(funcOrClassNode, functionValue.$Strict, declarator);
        }
      };

      if (additionalFunctionNestedInstances.length > 0) naiveProcessInstances(additionalFunctionNestedInstances);
      if (normalInstances.length > 0 && !this._shouldUseFactoryFunction(funcBody, normalInstances)) {
        naiveProcessInstances(normalInstances);
        this.getStatistics().functionClones--;
      } else if (normalInstances.length > 0) {
        const functionUniqueTag = ((funcBody: any): FunctionBodyAstNode).uniqueOrderedTag;
        invariant(functionUniqueTag);
        const factoryInfo = factoryFunctionInfos.get(functionUniqueTag);
        invariant(factoryInfo);
        const { factoryId } = factoryInfo;

        let curriedInstances = factoryInfo.isCurried ? this._partitionCurriedInstances(funcBody, normalInstances) : [];
        let useCurried = curriedInstances.length >= 2;
        if (useCurried && curriedInstances.length < normalInstances.length) {
          let curriedSet = new Set(curriedInstances);
          let fallbackInstances = normalInstances.filter(inst => !curriedSet.has(inst));
          naiveProcessInstances(fallbackInstances);
          normalInstances = curriedInstances;
        }
        let selfName = useCurried ? this._findSelfBindingName(funcBody, normalInstances) : undefined;
        // filter included variables to only include those that are different
        let factoryNames: Array<string> = [];
        let sameResidualBindings = new Map();
        for (let name of unbound.keys()) {
          if (useCurried && name === selfName) continue;
          let isDifferent = false;
          let lastBinding;

          let firstBinding = normalInstances[0].residualFunctionBindings.get(name);
          invariant(firstBinding);
          if (firstBinding.declarativeEnvironmentRecord === null && firstBinding.value === undefined) {
            sameResidualBindings.set(name, firstBinding);
            continue;
          }
          if (firstBinding.modified) {
            // Must modify for traversal
            sameResidualBindings.set(name, firstBinding);
            continue;
          }

          for (let { residualFunctionBindings } of normalInstances) {
            let residualBinding = residualFunctionBindings.get(name);

            invariant(residualBinding);
            invariant(!residualBinding.modified);
            if (!lastBinding) {
              lastBinding = residualBinding;
            } else if (!AreSameResidualBinding(this.realm, residualBinding, lastBinding)) {
              isDifferent = true;
              break;
            }
          }

          if (isDifferent) {
            factoryNames.push(name);
          } else {
            invariant(lastBinding);
            sameResidualBindings.set(name, lastBinding);
          }
        }

        let factoryParams: Array<BabelNodeLVal> = [];
        for (let key of factoryNames) {
          factoryParams.push(t.identifier(key));
        }

        if (useCurried) {
          let isLexical = normalInstances[0].functionValue.$ThisMode === "lexical";
          let innerTemplate = this._createFunctionExpression(params.slice(), funcBody, isLexical);
          if (selfName !== undefined && t.isFunctionExpression(innerTemplate)) {
            ((innerTemplate: any): BabelNodeFunctionExpression).id = t.identifier(selfName);
          }
          let innerFunc = new ResidualFunctionInstantiator(
            factoryFunctionInfos,
            this.realm.moduleFactoryFunctionsToRemove,
            this._getIdentifierReplacements(funcBody, sameResidualBindings),
            this._getCallReplacements(funcBody),
            innerTemplate
          ).instantiate();
          let isStrict = normalInstances[0].functionValue.$Strict;
          registerFunctionStrictness(innerFunc, isStrict);
          let factoryNode = t.functionExpression(null, factoryParams, t.blockStatement([t.returnStatement(innerFunc)]));
          registerFunctionStrictness(factoryNode, isStrict);
          let factoryDeclaration = t.variableDeclaration("var", [t.variableDeclarator(factoryId, factoryNode)]);
          this.prelude.push(factoryDeclaration);

          for (let instance of normalInstances) {
            let { functionValue, residualFunctionBindings } = instance;
            let functionId = this.locationService.getLocation(functionValue);
            invariant(functionId !== undefined);
            let allPreludeSafe = true;
            let flatArgs: Array<any> = factoryNames.map(name => {
              let residualBinding = residualFunctionBindings.get(name);
              invariant(residualBinding);
              if (!this._isPreludeSafeArg(residualBinding.value)) allPreludeSafe = false;
              let serializedValue = residualBinding.serializedValue;
              invariant(serializedValue);
              return serializedValue;
            });
            for (let sameRb of sameResidualBindings.values()) {
              if (sameRb.declarativeEnvironmentRecord === null && sameRb.value === undefined) continue;
              if (!this._isPreludeSafeArg(sameRb.value)) allPreludeSafe = false;
            }
            let funcNode = t.callExpression(factoryId, flatArgs);
            if (allPreludeSafe && instance.initializationStatements.length === 0) {
              preludeCurriedInstances.set(instance, {
                functionId,
                funcNode,
                params: params.slice(),
                funcBody,
                sameResidualBindings,
              });
            } else {
              let insertionPoint = instance.insertionPoint;
              let firstUsage = this.firstFunctionUsages.get(functionValue);
              if (
                insertionPoint === undefined ||
                (firstUsage !== undefined && !firstUsage.isNotEarlierThan(insertionPoint))
              ) {
                naiveProcessInstances([instance]);
              } else {
                defineFunction(instance, functionId, funcNode);
              }
            }
          }
          continue;
        }

        let scopeInitialization = [];
        for (let [scopeName, scope] of normalInstances[0].scopeInstances) {
          let scopeNameId = t.identifier(scopeName);
          factoryParams.push(scopeNameId);
          scopeInitialization = scopeInitialization.concat(
            this.referentializer.getReferentializedScopeInitialization(scope, scopeNameId)
          );
        }

        factoryParams = factoryParams.concat(params).slice();
        let factoryNode = new ResidualFunctionInstantiator(
          factoryFunctionInfos,
          this.realm.moduleFactoryFunctionsToRemove,
          this._getIdentifierReplacements(funcBody, sameResidualBindings),
          this._getCallReplacements(funcBody),
          this._createFunctionExpression(factoryParams, funcBody, false)
        ).instantiate();

        if (scopeInitialization.length > 0) {
          let factoryNodeBody = ((factoryNode.body: any): BabelNodeBlockStatement);
          invariant(t.isBlockStatement(factoryNodeBody));
          factoryNodeBody.body = scopeInitialization.concat(factoryNodeBody.body);
        }

        // factory functions do not depend on any nested generator scope, so they go to the prelude
        let factoryDeclarator = t.variableDeclarator(factoryId, factoryNode);
        let factoryDeclaration = t.variableDeclaration("var", [factoryDeclarator]);
        this.prelude.push(factoryDeclaration);

        registerFunctionStrictness(factoryNode, normalInstances[0].functionValue.$Strict, factoryDeclarator);

        for (let instance of normalInstances) {
          let { functionValue, residualFunctionBindings, insertionPoint } = instance;
          let functionId = this.locationService.getLocation(functionValue);
          invariant(functionId !== undefined);
          let hasFunctionArg = false;
          let flatArgs: Array<BabelNodeExpression> = factoryNames.map(name => {
            let residualBinding = residualFunctionBindings.get(name);
            invariant(residualBinding);
            let serializedValue = residualBinding.serializedValue;
            hasFunctionArg =
              hasFunctionArg || (residualBinding.value && residualBinding.value instanceof FunctionValue);
            invariant(serializedValue);
            return serializedValue;
          });
          let hasAnyLeakedIds = false;
          for (const scope of instance.scopeInstances.values()) {
            flatArgs.push(t.numericLiteral(scope.id));
            if (scope.leakedIds.length > 0) hasAnyLeakedIds = true;
          }
          let funcNode;
          let firstUsage = this.firstFunctionUsages.get(functionValue);
          // todo: why can this be undefined?
          invariant(insertionPoint !== undefined);

          let cannotBind =
            this.residualFunctionInitializers.hasInitializerStatement(functionValue) ||
            usesThis ||
            hasFunctionArg ||
            (firstUsage === undefined || !firstUsage.isNotEarlierThan(insertionPoint)) ||
            this.functionPrototypes.get(functionValue) !== undefined ||
            hasAnyLeakedIds;

          // TODO 2589: Code size reduction opportunity: bring back .bind calls
          cannotBind = true;

          if (cannotBind) {
            // The same free variables in shared instances may refer to objects with different initialization values
            // so a stub forward function is needed during delay initializations.

            let callArgs: Array<BabelNodeExpression | BabelNodeSpreadElement> = [t.thisExpression()];
            for (let flatArg of flatArgs) callArgs.push(flatArg);
            let hasNonIdentifierParam = params.some(param => param.type !== "Identifier");
            let wrapperParams: Array<BabelNodeLVal>;
            if (!hasNonIdentifierParam) {
              wrapperParams = params;
              for (let param of params) {
                callArgs.push(((param: any): BabelNodeIdentifier));
              }
            } else {
              let arity = params.length;
              for (let i = 0; i < params.length; i++) {
                if (t.isAssignmentPattern(params[i]) || t.isRestElement(params[i])) {
                  arity = i;
                  break;
                }
              }
              wrapperParams = [];
              for (let i = 0; i < arity; i++) {
                let paramId = t.identifier(this.factoryNameGenerator.generate("p"));
                wrapperParams.push(paramId);
                callArgs.push(paramId);
              }
              let restId = t.identifier(this.factoryNameGenerator.generate("args"));
              wrapperParams.push(t.restElement(restId));
              callArgs.push(t.spreadElement(restId));
            }

            let callee = t.memberExpression(factoryId, t.identifier("call"));

            let childBody = t.blockStatement([t.returnStatement(t.callExpression(callee, callArgs))]);

            let embeddedName = this.embeddedFunctionNames.get(functionValue);
            funcNode = t.functionExpression(
              embeddedName !== undefined ? t.identifier(embeddedName) : null,
              wrapperParams,
              childBody
            );
          } else {
            funcNode = t.callExpression(
              t.memberExpression(factoryId, t.identifier("bind")),
              [nullExpression].concat(flatArgs)
            );
          }

          let declarator = defineFunction(instance, functionId, funcNode);
          if (t.isFunctionExpression(funcNode)) {
            registerFunctionStrictness(
              ((funcNode: any): BabelNodeFunctionExpression),
              functionValue.$Strict,
              declarator
            );
          }
        }
      }
    }

    for (let referentializationScope of this.referentializer.referentializationState.keys()) {
      let prelude;
      // Get the prelude for this additional function value
      if (referentializationScope !== "GLOBAL") {
        let additionalFunction = referentializationScope;
        prelude = this.additionalFunctionPreludes.get(additionalFunction);
        invariant(prelude !== undefined);
      } else {
        prelude = this.prelude;
      }
      prelude.unshift(
        ...this.referentializer.createCapturedScopesPrelude(referentializationScope),
        ...this.referentializer.createLeakedIds(referentializationScope)
      );
    }

    if (preludeCurriedInstances.size > 0) {
      // Fixed-point check: ensure every FunctionValue referenced by a prelude-curried instance
      // is actually defined in prelude (either a FunctionExpression in preludeDefinedFuncs or another preludeCurriedInstance).
      let validInPrelude: Set<FunctionValue> = new Set(preludeDefinedFuncs);
      for (let inst of preludeCurriedInstances.keys()) validInPrelude.add(inst.functionValue);
      let changed = true;
      while (changed) {
        changed = false;
        for (let [inst, info] of Array.from(preludeCurriedInstances.entries())) {
          let allValid = true;
          for (let rb of inst.residualFunctionBindings.values()) {
            if (rb.value === inst.functionValue) continue;
            if (rb.declarativeEnvironmentRecord === null && rb.value === undefined) continue;
            if (!this._isPreludeSafeArg(rb.value, validInPrelude)) {
              allValid = false;
              break;
            }
          }
          if (!allValid) {
            preludeCurriedInstances.delete(inst);
            validInPrelude.delete(inst.functionValue);
            changed = true;
            // Fallback: emit as a normal FunctionExpression in prelude so all references remain valid!
            let { functionValue, residualFunctionBindings, scopeInstances } = inst;
            let isLexical = functionValue.$ThisMode === "lexical";
            let clonedNode = new ResidualFunctionInstantiator(
              factoryFunctionInfos,
              this.realm.moduleFactoryFunctionsToRemove,
              this._getIdentifierReplacements(info.funcBody, residualFunctionBindings),
              this._getCallReplacements(info.funcBody),
              this._createFunctionExpression(info.params, info.funcBody, isLexical)
            ).instantiate();
            invariant(scopeInstances.size === 0);
            let declarator = defineFunction(inst, info.functionId, clonedNode);
            registerFunctionStrictness(clonedNode, functionValue.$Strict, declarator);
            if (
              (!isLexical || this._canArrowGoToPrelude(functionValue)) &&
              inst.containingAdditionalFunction === undefined
            ) {
              validInPrelude.add(functionValue);
            }
          }
        }
      }

      let visitedPrelude = new Set();
      const emitPreludeInstance = (inst: FunctionInstance): void => {
        if (visitedPrelude.has(inst)) return;
        visitedPrelude.add(inst);
        for (let rb of inst.residualFunctionBindings.values()) {
          if (rb.value instanceof FunctionValue && rb.value !== inst.functionValue) {
            let depInst = this.residualFunctionInstances.get(rb.value);
            if (depInst !== undefined && preludeCurriedInstances.has(depInst)) {
              emitPreludeInstance(depInst);
            }
          }
        }
        let info = preludeCurriedInstances.get(inst);
        if (info !== undefined) {
          this.prelude.push(t.variableDeclaration("var", [t.variableDeclarator(info.functionId, info.funcNode)]));
        }
      };
      for (let inst of preludeCurriedInstances.keys()) {
        emitPreludeInstance(inst);
      }
    }

    let orderedBodyInstances = [];
    let bodyInstanceSet = new Set();
    for (let instance of this.functionInstances) {
      if (functionBodies.has(instance)) bodyInstanceSet.add(instance);
    }
    const getMinClassIndex = (fv: FunctionValue, body: SerializedBody): number => {
      let cmi = this.residualClassMethodInstances.get(fv);
      if (cmi !== undefined && cmi.minInsertionBody === body && cmi.minInsertionIndex !== undefined) {
        return cmi.minInsertionIndex;
      }
      return 0;
    };
    let minPropChanged = true;
    while (minPropChanged) {
      minPropChanged = false;
      for (let instance of bodyInstanceSet) {
        let fv = instance.functionValue;
        let cmi = this.residualClassMethodInstances.get(fv);
        if (cmi === undefined) continue;
        let ip = instance.insertionPoint;
        if (!(ip instanceof BodyReference)) continue;
        let superVal = fv.$Prototype;
        if (!(superVal instanceof FunctionValue) || superVal === fv) continue;
        let superMin = getMinClassIndex(superVal, ip.body);
        let curMin = getMinClassIndex(fv, ip.body);
        if (superMin > curMin) {
          cmi.minInsertionBody = ip.body;
          cmi.minInsertionIndex = superMin;
          minPropChanged = true;
        }
      }
    }
    for (let instance of bodyInstanceSet) {
      let fv = instance.functionValue;
      if (!this.residualClassMethodInstances.has(fv)) continue;
      let ip = instance.insertionPoint;
      if (!(ip instanceof BodyReference)) continue;
      let byBody = this.firstFunctionUsagesPerBody.get(fv);
      let firstUsage = byBody !== undefined ? byBody.get(ip.body) : this.firstFunctionUsages.get(fv);
      if (firstUsage instanceof BodyReference && firstUsage.body === ip.body) {
        let targetIdx = Math.max(firstUsage.index, getMinClassIndex(fv, ip.body));
        if (targetIdx < ip.index) {
          instance.insertionPoint = new BodyReference(ip.body, targetIdx);
        }
      }
    }
    let superOrderChanged = true;
    while (superOrderChanged) {
      superOrderChanged = false;
      for (let instance of bodyInstanceSet) {
        let fv = instance.functionValue;
        if (!this.residualClassMethodInstances.has(fv)) continue;
        let ip = instance.insertionPoint;
        if (!(ip instanceof BodyReference)) continue;
        let superVal = fv.$Prototype;
        if (!(superVal instanceof FunctionValue) || superVal === fv) continue;
        let superInst = this.residualFunctionInstances.get(superVal);
        if (
          superInst !== undefined &&
          bodyInstanceSet.has(superInst) &&
          superInst.insertionPoint instanceof BodyReference &&
          superInst.insertionPoint.body === ip.body &&
          superInst.insertionPoint.index > ip.index
        ) {
          let superMin = getMinClassIndex(superVal, ip.body);
          let targetIdx = Math.max(ip.index, superMin);
          superInst.insertionPoint = new BodyReference(ip.body, targetIdx);
          if (targetIdx > ip.index) {
            instance.insertionPoint = new BodyReference(ip.body, targetIdx);
          }
          superOrderChanged = true;
        }
      }
    }
    let visitedBodyInstances = new Set();
    const visitSameIndexDep = (depVal: Value, ownerFv: FunctionValue, ip: BodyReference): void => {
      if (!(depVal instanceof FunctionValue) || depVal === ownerFv) return;
      let depInst = this.residualFunctionInstances.get(depVal);
      if (
        depInst !== undefined &&
        bodyInstanceSet.has(depInst) &&
        depInst.insertionPoint instanceof BodyReference &&
        depInst.insertionPoint.body === ip.body &&
        depInst.insertionPoint.index === ip.index
      ) {
        visitBodyInstance(depInst);
      }
    };
    const visitBodyInstance = (instance: FunctionInstance): void => {
      if (visitedBodyInstances.has(instance)) return;
      visitedBodyInstances.add(instance);
      let ip = instance.insertionPoint;
      if (ip instanceof BodyReference) {
        let fv = instance.functionValue;
        if (this.residualClassMethodInstances.has(fv)) {
          visitSameIndexDep(fv.$Prototype, fv, ip);
          for (let [memberFn, cmi] of this.residualClassMethodInstances) {
            if (cmi.classConstructor === fv && memberFn !== fv) {
              let memberInst = this.residualFunctionInstances.get(memberFn);
              if (memberInst !== undefined) {
                for (let rb of memberInst.residualFunctionBindings.values()) {
                  if (rb.value !== undefined) visitSameIndexDep(rb.value, fv, ip);
                }
              }
            }
          }
        }
        for (let rb of instance.residualFunctionBindings.values()) {
          if (rb.value !== undefined) visitSameIndexDep(rb.value, fv, ip);
        }
      }
      orderedBodyInstances.push(instance);
    };
    for (let instance of this.functionInstances) {
      if (bodyInstanceSet.has(instance)) visitBodyInstance(instance);
    }
    orderedBodyInstances.sort((a, b) => {
      let ipa = a.insertionPoint;
      let ipb = b.insertionPoint;
      invariant(ipa instanceof BodyReference && ipb instanceof BodyReference);
      if (ipa.body !== ipb.body) return 0;
      return ipb.index - ipa.index;
    });
    // Group by (body, index) so higher indices splice first and within the same index topological order is preserved.
    let idx = 0;
    while (idx < orderedBodyInstances.length) {
      let first = orderedBodyInstances[idx];
      let ip = first.insertionPoint;
      invariant(ip instanceof BodyReference);
      let combined = [];
      while (idx < orderedBodyInstances.length) {
        let cur = orderedBodyInstances[idx];
        let curIp = cur.insertionPoint;
        invariant(curIp instanceof BodyReference);
        if (curIp.body !== ip.body || curIp.index !== ip.index) break;
        let fb = functionBodies.get(cur);
        if (fb !== undefined) combined.push(...fb);
        idx++;
      }
      if (combined.length > 0) {
        ip.body.entries.splice(ip.index, 0, ...combined);
      }
    }

    // Inject initializer code for indexed vars into functions (for delay initializations)
    for (let [functionValue, funcNode] of funcNodes) {
      let initializerStatement = this.residualFunctionInitializers.getInitializerStatement(functionValue);
      if (initializerStatement !== undefined) {
        invariant(
          t.isFunctionExpression(funcNode) || t.isArrowFunctionExpression(funcNode) || t.isClassMethod(funcNode)
        );
        let blockStatement: BabelNodeBlockStatement = ((funcNode: any).body: BabelNodeBlockStatement);
        invariant(t.isBlockStatement(blockStatement));
        if (rewrittenAdditionalFunctions.has(functionValue)) {
          blockStatement.body.unshift(initializerStatement);
        } else {
          (funcNode: any).body = t.blockStatement(
            [initializerStatement].concat(blockStatement.body),
            blockStatement.directives
          );
        }
      }
    }

    for (let [additionalFunction, body] of Array.from(rewrittenAdditionalFunctions.entries()).reverse()) {
      let additionalFunctionInfo = this.additionalFunctionValueInfos.get(additionalFunction);
      invariant(additionalFunctionInfo);
      // Modified bindings initializers of optimized function
      let bodySegment = additionalFunctionModifiedBindingsSegment.get(additionalFunction);
      // initializers from Referentialization
      let initializationStatements = getFunctionBody(additionalFunctionInfo.instance);
      let prelude = this.additionalFunctionPreludes.get(additionalFunction);
      invariant(prelude !== undefined);
      let insertionPoint = additionalFunctionInfo.instance.insertionPoint;
      invariant(insertionPoint);
      // TODO: I think this inserts things in the wrong place
      insertionPoint.body.entries.splice(insertionPoint.index, 0, ...initializationStatements);
      if (bodySegment) body.unshift(...bodySegment);
      body.unshift(...prelude);
    }

    return { unstrictFunctionBodies, strictFunctionBodies, strictFunctionDeclarators };
  }
  _getOrCreateClassNode(classPrototype: ObjectValue): BabelNodeClassExpression {
    if (!this.classes.has(classPrototype)) {
      let funcOrClassNode = t.classExpression(null, null, t.classBody([]), []);
      this.classes.set(classPrototype, funcOrClassNode);
      return funcOrClassNode;
    } else {
      let funcOrClassNode = this.classes.get(classPrototype);
      invariant(funcOrClassNode && t.isClassExpression(funcOrClassNode));
      return funcOrClassNode;
    }
  }
}
