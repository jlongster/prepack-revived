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

export type Compatibility =
  | "browser"
  | "jsc-600-1-4-17"
  | "mobile"
  | "node-source-maps"
  | "fb-www"
  | "node-react"
  | "node"
  | "universal";
export const CompatibilityValues = [
  "browser",
  "jsc-600-1-4-17",
  "mobile",
  "node-source-maps",
  "fb-www",
  "node-react",
  "node",
  "universal",
];

export type UnknownGlobalsMode = "open" | "closed" | "error";
export const UnknownGlobalsModeValues = ["open", "closed", "error"];

export type AssumptionFallbackMode = "inline" | "throw";
export const AssumptionFallbackModeValues = ["inline", "throw"];

export type InvariantModeTypes =
  | "throw"
  | "console.info"
  | "console.warn"
  | "console.error"
  | "nativeLoggingHook+0"
  | "nativeLoggingHook+1"
  | "nativeLoggingHook+3"
  | "nativeLoggingHook+2";
export const InvariantModeValues = [
  "throw",
  "console.info",
  "console.warn",
  "console.error",
  "nativeLoggingHook+0",
  "nativeLoggingHook+1",
  "nativeLoggingHook+2",
  "nativeLoggingHook+3",
];
export const DiagnosticSeverityValues = ["FatalError", "RecoverableError", "Warning", "Information"];

export type ReactOutputTypes = "create-element" | "jsx" | "bytecode";
export const ReactOutputValues = ["create-element", "jsx", "bytecode"];

export type SmtMode = "off" | "fallback" | "audit";
export const SmtModeValues = ["off", "fallback", "audit"];

export type RealmOptions = {
  check?: Array<number>,
  compatibility?: Compatibility,
  debugNames?: boolean,
  errorHandler?: ErrorHandler,
  mathRandomSeed?: string,
  invariantLevel?: number,
  invariantMode?: InvariantModeTypes,
  emitConcreteModel?: boolean,
  uniqueSuffix?: string,
  serialize?: boolean,
  strictlyMonotonicDateNow?: boolean,
  timeout?: number,
  maxStackDepth?: number,
  instantRender?: boolean,
  reactEnabled?: boolean,
  reactOutput?: ReactOutputTypes,
  reactVerbose?: boolean,
  reactOptimizeNestedFunctions?: boolean,
  stripFlow?: boolean,
  abstractValueImpliesMax?: number,
  arrayNestedOptimizedFunctionsEnabled?: boolean,
  // When false, calls are always evaluated (inlined) rather than turned into residual calls by
  // the size and recursion heuristics (src/methods/inlining.js, src/methods/recursion.js).
  residualCallHeuristics?: boolean,
  reactFailOnUnsupportedSideEffects?: boolean,
  removeModuleFactoryFunctions?: boolean,
  closedWorld?: boolean,
  unknownGlobals?: UnknownGlobalsMode,
  hasExplicitCompatibility?: boolean,
  assumptions?: { [string]: mixed },
  fallbackMode?: AssumptionFallbackMode,
  smt?: SmtMode,
};

export type SerializerOptions = {
  lazyObjectsRuntime?: string,
  delayInitializations?: boolean,
  modulesToInitialize?: Set<string | number> | "ALL",
  internalDebug?: boolean,
  debugScopes?: boolean,
  debugIdentifiers?: Array<string>,
  logStatistics?: boolean,
  logModules?: boolean,
  profile?: boolean,
  inlineExpressions?: boolean,
  trace?: boolean,
  heapGraphFormat?: "DotLanguage" | "VISJS",
  fallbackMode?: AssumptionFallbackMode,
};

export const defaultOptions = {};
