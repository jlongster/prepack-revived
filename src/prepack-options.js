/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow strict-local */

import type { ErrorHandler } from "./errors.js";
import type {
  SerializerOptions,
  RealmOptions,
  Compatibility,
  ReactOutputTypes,
  InvariantModeTypes,
  UnknownGlobalsMode,
  AssumptionFallbackMode,
} from "./options";
import { type Realm } from "./realm.js";
import { type Generator } from "./utils/generator.js";
import { type FunctionValue } from "./values/index.js";
import type { DebuggerConfigArguments, DebugReproArguments } from "./types";
import type { BabelNodeFile } from "@babel/types";

export type PrepackOptions = {|
  additionalGlobals?: Realm => void,
  lazyObjectsRuntime?: string,
  heapGraphFormat?: "DotLanguage" | "VISJS",
  compatibility?: Compatibility,
  debugNames?: boolean,
  delayInitializations?: boolean,
  inputSourceMapFilenames?: Array<string>,
  internalDebug?: boolean,
  debugScopes?: boolean,
  debugIdentifiers?: Array<string>,
  logStatistics?: boolean,
  logModules?: boolean,
  mathRandomSeed?: string,
  errorHandler?: ErrorHandler,
  invariantLevel?: number,
  invariantMode?: InvariantModeTypes,
  emitConcreteModel?: boolean,
  outputFilename?: string,
  profile?: boolean,
  instantRender?: boolean,
  reactEnabled?: boolean,
  reactOutput?: ReactOutputTypes,
  reactVerbose?: boolean,
  reactOptimizeNestedFunctions?: boolean,
  serialize?: boolean,
  check?: Array<number>,
  inlineExpressions?: boolean,
  removeModuleFactoryFunctions?: boolean,
  sourceMaps?: boolean,
  modulesToInitialize?: Set<string | number> | "ALL",
  statsFile?: string,
  strictlyMonotonicDateNow?: boolean,
  stripFlow?: boolean,
  timeout?: number,
  trace?: boolean,
  uniqueSuffix?: string,
  maxStackDepth?: number,
  debugInFilePath?: string,
  debugOutFilePath?: string,
  abstractValueImpliesMax?: number,
  debuggerConfigArgs?: DebuggerConfigArguments,
  debugReproArgs?: DebugReproArguments,
  onParse?: BabelNodeFile => void,
  onExecute?: (Realm, Map<FunctionValue, Generator>) => void,
  arrayNestedOptimizedFunctionsEnabled?: boolean,
  residualCallHeuristics?: boolean,
  reactFailOnUnsupportedSideEffects?: boolean,
  closedWorld?: boolean,
  unknownGlobals?: UnknownGlobalsMode,
  assumptions?: { [string]: mixed },
  fallbackMode?: AssumptionFallbackMode,
  profileEnv?: "node" | "browser",
  smt?: "off" | "fallback" | "audit",
|};

export function getRealmOptions({
  compatibility,
  debugNames = false,
  errorHandler,
  mathRandomSeed,
  invariantLevel = 0,
  invariantMode = "throw",
  emitConcreteModel = false,
  uniqueSuffix,
  instantRender,
  reactEnabled,
  reactOutput,
  reactVerbose,
  reactOptimizeNestedFunctions,
  serialize = true,
  check,
  strictlyMonotonicDateNow,
  stripFlow,
  timeout,
  maxStackDepth,
  abstractValueImpliesMax,
  debuggerConfigArgs,
  debugReproArgs,
  arrayNestedOptimizedFunctionsEnabled,
  residualCallHeuristics,
  reactFailOnUnsupportedSideEffects,
  removeModuleFactoryFunctions,
  closedWorld,
  unknownGlobals,
  assumptions,
  fallbackMode,
  smt,
}: PrepackOptions): RealmOptions {
  return {
    compatibility: compatibility !== undefined ? compatibility : "browser",
    hasExplicitCompatibility: compatibility !== undefined,
    debugNames,
    errorHandler,
    mathRandomSeed,
    invariantLevel,
    invariantMode,
    emitConcreteModel,
    uniqueSuffix,
    instantRender,
    reactEnabled,
    reactOutput,
    reactVerbose,
    reactOptimizeNestedFunctions,
    serialize,
    check,
    strictlyMonotonicDateNow,
    stripFlow,
    timeout,
    maxStackDepth,
    abstractValueImpliesMax,
    debuggerConfigArgs,
    debugReproArgs,
    arrayNestedOptimizedFunctionsEnabled,
    residualCallHeuristics,
    reactFailOnUnsupportedSideEffects,
    removeModuleFactoryFunctions,
    closedWorld,
    unknownGlobals,
    assumptions,
    fallbackMode,
    smt,
  };
}

export function getSerializerOptions({
  lazyObjectsRuntime,
  heapGraphFormat,
  delayInitializations = false,
  internalDebug = false,
  debugScopes = false,
  debugIdentifiers,
  logStatistics = false,
  logModules = false,
  profile = false,
  inlineExpressions,
  modulesToInitialize,
  trace = false,
  fallbackMode,
}: PrepackOptions): SerializerOptions {
  let result: SerializerOptions = {
    delayInitializations,
    modulesToInitialize,
    internalDebug,
    debugScopes,
    debugIdentifiers,
    logStatistics,
    logModules,
    profile,
    inlineExpressions: inlineExpressions !== undefined ? inlineExpressions : lazyObjectsRuntime === undefined,
    trace,
  };
  if (lazyObjectsRuntime !== undefined) {
    result.lazyObjectsRuntime = lazyObjectsRuntime;
  }
  if (heapGraphFormat !== undefined) {
    result.heapGraphFormat = heapGraphFormat;
  }
  if (fallbackMode !== undefined) {
    result.fallbackMode = fallbackMode;
  }
  return result;
}
