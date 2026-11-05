# Track 2B (R4): Environment Modeling, Open-World Globals & Guarded Speculation (`P7`)

## 1. Overview & Headline Results

Upstream Prepack suffered from a fundamental **two-mode silent-miscompile trap (`P7`)** whenever real-world JavaScript bundles probed or interacted with their host environment during initialization:

1. **Closed-world folding of missing globals:** Undeclared globals (`typeof window`, `typeof exports`, `typeof define`, `typeof process`, `typeof Intl`, `typeof globalThis`) folded unconditionally to `"undefined"` and bare reads threw `ReferenceError`, baking build-host absence into the serialized output (`window-global-alias.js`, `intl-number-format.js`, UMD wrappers).
2. **Build-host contamination of locale & timezone intrinsics:** `new Date(2020, 0, 1).getTime()`, `Date.prototype.getTimezoneOffset()`, and `Number.prototype.toLocaleString()` evaluated against the compiler's own `TZ` and ICU locale (`date-local-timezone.js`, `number-to-locale-string.js`), silently emitting wrong numbers and strings whenever the target machine differed from the build machine.
3. **Unconditional startup exceptions shipped as `Warning PP0023`:** When an environment or ES2015+ model gap caused global initialization to throw inside Prepack (e.g. `handlebars@4.7.10` running `Object.prototype.__defineGetter__('__magic__', ...)` because `globalThis` was missing, or `highlight.js@11.12.0` running `deepFreeze` over `Object.freeze({ __proto__: null, ... })` because Annex B.3.1 `__proto__` in object literals created an own `"__proto__": null` property), Prepack logged only `Warning PP0023: Program may terminate with exception` and exited `0`, shipping a bundle whose entire body was `throw new TypeError(...)`.

We implemented five complementary layers—**(1) Soundness First & `FatalError PP0023`**, **(2) Open-World Globals & UMD Preservation**, **(3) `.d.ts`-Generated DOM / Node / `Intl` Environment Models**, **(4) Guarded Speculation with Runtime Fallback**, and **(5) Timezone- & Locale-Safe `Date` / `Intl`**—eliminating **100% of silent miscompiles (`WRONG`)** in `P7-environment` and across all **22 real-world benchmark workloads (`132` profile runs)**.

### Hard Corpus Summary (`node scripts/hard-scoreboard.js`)

| Scope | Baseline (`revive` pre-`env`) | Final (`env`) | Delta |
|---|---|---|---|
| **`P7-environment` (original 15 tests)** | 2 PASS / 4 CRASH / **8 WRONG** / 1 BLOAT | **15 PASS / 0 CRASH / 0 WRONG / 0 BLOAT** | **+13 PASS, -4 CRASH, -8 WRONG, -1 BLOAT (100% PASS)** |
| **`P7-environment` (full 19 tests incl. 4 new)** | — | **19 PASS / 0 CRASH / 0 WRONG / 0 BLOAT** | **19/19 PASS (100% PASS)** |
| **`real-world-libs` (8 tests)** | 1 PASS / 6 CRASH / **1 WRONG** / 0 BLOAT | **5 PASS / 3 CRASH / 0 WRONG / 0 BLOAT** | **+4 PASS, -3 CRASH, -1 WRONG** |
| **`P9-generators-async` (4 tests)** | 0 PASS / 1 CRASH / 3 WRONG / 0 BLOAT | **1 PASS / 1 CRASH / 2 WRONG / 0 BLOAT** | **+1 PASS, -1 WRONG (`generator-function-defined-not-called`)** |
| **Full 175-test corpus** | — | **150 PASS / 15 CRASH / 9 WRONG / 1 BLOAT** | **0 new WRONG anywhere** |

*Note on existing serializer suite compatibility:* Across the full `yarn test-serializer` suite (**3,622/3,622 passing iterations** across all flag permutations) and `yarn test-error-handler` (**43/43 passing**), **zero** existing tests required `--closedWorld` or modified expectations to remain green under the new open-world default.

### Real-World Benchmark Summary (`bench/run.js`, 22 Workloads × 6 Profiles = 132 Runs)

| Metric | Baseline (`revive` + `bench2`) | Final (`env`) | Delta |
|---|---:|---:|---|
| **OK (default zero-flag options)** | 10 / 22 | **13 / 22** | **+3 (`underscore`, `redux`, `d3-scale`, `handlebars-app`, `highlight-js` unlocked; `lodash`/`moment-timezone` `OK` on `browser-opt`)** |
| **OK (best option profile)** | 12 / 22 | **15 / 22** | **+3 (`handlebars-app`, `highlight-js`, `d3-scale` unlocked end-to-end)** |
| **`WRONG` (silent miscompiles across all 22 workloads)** | **2 / 22** *(11 profile runs)* | **0 / 22** *(0 profile runs)* | **100% of silent miscompiles eliminated (`0 / 132` runs)** |
| **`FAIL` (clean diagnostic)** | 8 / 22 | **7 / 22** | Non-environment syntax/TypedArray blockers (`PP1004`, `PP0037`) |
| **`TIMEOUT`** | 0 / 22 | **0 / 22** | — |

Key workload transitions:
- **`handlebars-app` (`handlebars@4.7.10`, 211.9 KB):** `WRONG (PP0023)` on all 6 profiles -> **`OK` on all 6 profiles** (`default`, `browser-opt`, `browser-seed`, `jsc`, `node-react`, `lazy-objects`).
- **`highlight-js` (`highlight.js@11.12.0`, all 193 languages, 1,834.5 KB):** `WRONG (PP0023)` on all 6 profiles -> **`OK` on 5 profiles including zero-flag `default`** (`FAIL PP0023` on `jsc`).
- **`underscore` (`underscore@1.13.8`, 67.3 KB):** `FAIL (PP0001)` on 5/6 profiles (`document.childNodes`) -> **`OK` on all 6 profiles**.
- **`redux` (`redux@5.0.1`, 18.1 KB):** `FAIL (PP0031)` on `default` / `browser-opt` (`Math.random().toString(36).substring(7).split("").join(".")`) -> **`OK` on all 6 profiles**.
- **`d3-scale` (`d3-scale@4.0.3` + `d3-array` + `internmap`, 148.9 KB):** `FAIL` -> **`OK` on 5 profiles including zero-flag `default`**.
- **`preact-ssr-app`, `react-ssr-app`, `three` (`jsc`):** All `WRONG (PP0023)` profile runs eliminated (either `OK` or clean `FatalError PP0023`).
- **Full `react.development.js` + `react-dom.development.js` bundle (`623 KB`):** Compiles in ~4.6s under `--compatibility browser` with **0 diagnostics** and renders identical DOM output in `jsdom`.

---

## 2. Architecture & Five Strategies

### Strategy 1: Soundness First (`src/options.js`, `src/evaluators/Program.js`, `src/realm.js`)

1. **Open-world by default (`unknownGlobals: "open"`):**
   - Added `--unknownGlobals open|error|closed` (default `"open"`) and `--closedWorld` (alias for `unknownGlobals: "closed"`).
   - Under `"open"`, `typeof <undeclaredGlobal>` emits a residual `typeof X` (`TYPEOF_GLOBAL`) rather than folding to `"undefined"`, and reading an undeclared global produces a temporal environment `AbstractValue` (`ENV_GLOBAL`) rather than throwing a build-time `ReferenceError`.
   - Under `"error"`, referencing any global outside ECMAScript intrinsics and the `.d.ts` environment catalog aborts cleanly with `FatalError PP0051`.
   - Under `"closed"` (`--closedWorld`), legacy closed-world semantics are preserved for controlled embedded runtimes.
2. **Definite top-level engine/model exceptions are `FatalError PP0023`, never `Warning PP0023`:**
   - Tagged engine-constructed `Error` / `TypeError` / `ReferenceError` / `RangeError` completions (`$IsEngineError = true` in `Realm.createErrorThrowCompletion`) and uncaught top-level `Error` instances (`$ErrorData !== undefined` in `Program.js`).
   - When global initialization unconditionally terminates in `ThrowCompletion` with an engine/model error under abstract interpretation (`!realm.closedWorld`), `Program.js` emits `FatalError PP0023` ("Global initialization unconditionally terminates with exception") and aborts serialization instead of emitting a bundle that unconditionally `throw`s at startup.
   - Deliberate user primitive throws in tests (e.g. `throw "oopsie"` in `DoWhile2a.js`) and conditional runtime throws inside functions (`Warning PP0023`) retain their existing behavior.
3. **Missing ECMAScript & Annex B intrinsics that triggered real-world polyfill crashes:**
   - **ES2020 `globalThis` (`src/intrinsics/ecma262/global.js`):** Defined `{ value: global, writable: true, enumerable: false, configurable: true }` on `$GlobalObject`.
   - **Annex B.2.2.2–B.2.2.5 accessor methods (`src/intrinsics/ecma262/ObjectPrototype.js`):** Implemented `Object.prototype.{__defineGetter__,__defineSetter__,__lookupGetter__,__lookupSetter__}` (used by Mathias Bynens' `globalThis` polyfill in Handlebars and legacy libraries).
   - **Annex B.3.1 `{ __proto__: proto }` in object literals (`src/evaluators/ObjectExpression.js`):** Non-computed, non-shorthand, non-method `__proto__:` properties now call `obj.$SetPrototypeOf(propValue)` rather than creating an own enumerable `"__proto__"` data property (which broke Rollup/esbuild ESM namespace objects `Object.freeze({ __proto__: null, ... })` in `highlight.js`), while `{ ["__proto__"]: x }` and `{ __proto__ }` shorthand remain ordinary own data properties per spec. Also updated `ResidualHeapSerializer._serializeValueObjectViaConstructor` so null-prototype objects always serialize via ES5 `Object.create(null)` rather than `(__constructor.prototype = null, new __constructor())` (which in JS resets `[[Prototype]]` to `Object.prototype`).
   - **Subclasses of native constructors & generator functions (`ResidualHeapVisitor.js`, `ResidualHeapSerializer.js`, `ResidualFunctions.js`, `HeapInspector.js`):** Fixed `_visitClass` / `_serializeClass` checking `!(classFunc.$Prototype instanceof NativeFunctionValue)` instead of `classFunc.$Prototype !== realm.intrinsics.FunctionPrototype` (which broke `class extends Error` in `highlight.js` and `class InternMap extends Map` in `d3-scale`), prevented factory-function extraction on class methods using `super`, and preserved `function*` syntax and `%GeneratorPrototype%` defaults for defined-at-init generator functions.

### Strategy 2: Open-World Mode & UMD Wrapper Support (`src/intrinsics/env/models.js`, `src/methods/environment.js`)

1. **Isolation via `isEnvironmentValue` / `isEnvironmentDerived`:**
   - Environment-originating abstract values carry `isEnvironmentValue = true` (and `isEnvironmentDerived(val)` recognizes boolean/equality/logical/conditional/`ToObject` combinations over environment values).
   - Property reads (`AbstractObjectValue.$Get`, `$GetPartial`), property writes (`$SetPartial`, `$DefineOwnProperty`), method/function calls (`CallExpression`), constructor calls (`NewExpression`), `in`/`instanceof` (`BinaryExpression`), `Object(x)` / `Object.getOwnPropertyNames(x)` (`Object.js`), and `Object.prototype.toString.call(x)` (`ObjectProto_toString.js`) emit clean temporal operations on environment values **without** relaxing Prepack's `PP0001`/`PP0004`/`PP0005`/`PP0012`/`PP0017`/`PP0031` diagnostics on ordinary user `__abstract(...)` values.
2. **Identifier hoisting & UMD invariants:**
   - Marked `ENV_GLOBAL` and `TYPEOF_GLOBAL` (and `define.amd`) as leaves in `HeapInspector.isLeaf` so the serializer never hoists a bare identifier `X` outside the `if (typeof X !== "undefined")` branch that guards it (preventing runtime `ReferenceError`s).
   - Aliased free `window` and `self` (and `self.self`, `window.window`) to `realm.$GlobalObject` when dereferenced, while keeping `typeof window` and `typeof self` residual when `--compatibility` is omitted.
   - Memoized `define.amd` in `realm._envGlobals` so multi-UMD bundles (`preact` + `preact-render-to-string`, `react` + `react-dom-server`, `js-yaml` + `mustache`) share identical path conditions across UMD headers instead of multiplying branches `3^N`.
   - When an explicit target `--compatibility` is supplied (`--compatibility browser` or `--compatibility node`), module-system wrapper probes (`typeof exports`, `typeof module`, `typeof define`, `typeof require`) resolve to the target module system while feature-detection globals (`typeof window`, `typeof document`, `typeof navigator`, `typeof Intl`) remain residual so SSR/partial environments stay safe.
3. **Non-deterministic `Math.random()` chains (`IntervalDomain.js`, `summaries.js`, `TemplateLiteral.js`, `ArrayPrototype.js`):**
   - Gave `Math.random()` interval `[0, 1]` in `IntervalDomain.fromAbstract` and typed `String.prototype.split` results with `envElementType = StringValue` (supporting `.length`, `[0]`, `[k]`, `.join(...)`, and `.filter(Boolean)`), plus abstract template-literal interpolation in `TemplateLiteral.js`, unlocking `redux@5.0.1` (`@@redux/INIT${Math.random().toString(36).substring(7).split("").join(".")}`) without requiring `--mathRandomSeed`.

### Strategy 3: Environment Models Generated from `.d.ts` (`scripts/generate-env-models.js`, `src/intrinsics/env/generatedModels.js`)

- Built `scripts/generate-env-models.js` using the TypeScript compiler API against `lib.dom.d.ts`, `lib.es*.intl.d.ts`, and `@types/node/*.d.ts` to generate `src/intrinsics/env/generatedModels.js`:
  - **77 interface shapes** (`Window`, `Document`, `Element`, `HTMLElement`, `SVGElement`, `CSSStyleDeclaration`, `DOMTokenList`, `NodeList`, `HTMLCollection`, `Storage`, `Navigator`, `Location`, `History`, `Performance`, `Event`, `CustomEvent`, `MutationObserver`, `URL`, `URLSearchParams`, `Headers`, `Request`, `Response`, `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.Collator`, `Intl.PluralRules`, `Intl.RelativeTimeFormat`, `NodeJS.Process`, `NodeJS.ProcessEnv`, `Buffer`, `BufferConstructor`, `node:path`, `node:os`, `node:url`, `node:util`, etc.).
  - **102 DOM globals**, **10 Node globals**, **UMD globals**, and **core Node `require("path" | "os" | "url" | "util")` shapes**.
- **Lazy materialization:** Schemas are plain static tables; abstract objects and property types are materialized only when user init code actually touches a global or property, adding **zero** Realm startup cost when unused.
- **Conservative purity & async schedulers:**
  - Every host method/getter is treated as temporal (`createTemporalFromBuildFunction`) so calls are never DCE'd or reordered across side effects, and host methods are typed `FunctionValue | undefined` prior to truthiness guards so `typeof el.animate` or `typeof document.createElement` stays residual.
  - Host async schedulers (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `setImmediate`, `clearImmediate`, `requestAnimationFrame`, `cancelAnimationFrame`, `requestIdleCallback`, `queueMicrotask`) emit residual registration calls at init without invoking callbacks synchronously during global init (since async callbacks always run on subsequent event-loop turns after synchronous top-level initialization completes).
  - Updated `src/intrinsics/dom/document.js` to expose `head`, `documentElement`, `childNodes`, and typed element-creation metadata (`HTMLElement`), fixing `underscore`'s `document.childNodes` feature detection across all profiles.

### Strategy 4: Guarded Speculation (`src/intrinsics/env/assumptions.js`)

Added opt-in environment specialization backed by automatic runtime guards:
- **CLI & API options:**
  - `--assume KEY=JSON` (repeatable, e.g. `--assume 'typeof window="undefined"' --assume 'process.env.NODE_ENV="production"' --assume timezoneOffset=0`)
  - `--assumptionsFile path/to/assumptions.json`
  - `--profileEnv node|browser` (`profileEnvironment(sources, target)` scans environment probes in input ASTs and populates target assumptions automatically)
  - `--fallbackMode inline|throw` (default `"inline"`)
- **Recorded guard generation (`wrapWithAssumptionGuards`):**
  - Only assumptions actually queried during partial evaluation emit runtime checks in the output bundle's guard conjunction.
  - `typeof X = "undefined"` emits `typeof X === "undefined"`.
  - Dotted value assumptions like `process.env.NODE_ENV = "production"` emit safe null-guarded checks (`typeof process !== "undefined" && process !== null && process.env != null && process.env.NODE_ENV === "production"`).
  - `timezoneOffset = N` emits a **dual-solstice DST check**: `new Date(0).getTimezoneOffset() === N && new Date(1593561600000).getTimezoneOffset() === N` (checking both January and July so regions with Daylight Saving Time cannot falsely pass a constant-offset assumption).
- **Fallback behavior:**
  - Under `fallbackMode: "inline"` (default), top-level `var` declarations are hoisted and the specialized bundle runs in the `if (guard)` fast path while the original input code sits in the `else` slow path—guaranteeing 100% semantic equivalence even when deployed to an unexpected host (`P7-environment/guarded-speculation-fallback.js`).
  - Under `fallbackMode: "throw"`, a guard failure throws a descriptive `Error("Prepack environment assumption violated at runtime")` without embedding the original source, keeping bundle size minimal (`P7-environment/guarded-speculation-holds.js`).

### Strategy 5: Timezone- and Locale-Safe `Date` and `Intl` (`Date.js`, `DatePrototype.js`, `NumberPrototype.js`)

1. **UTC operations fold; local-timezone operations stay residual unless guarded:**
   - `Date.UTC(...)`, `new Date(epochNumber)` (timestamp construction itself is UTC-defined), `new Date("2020-01-15T12:30:00.000Z")` / `Date.parse(...)` on strings with explicit `Z` or `±HH:MM` offsets, `Date.prototype.getTime()`, `valueOf()`, `toISOString()`, `toUTCString()`, and `getUTCFullYear()`/`getUTCMonth()`/`getUTCDate()`/`getUTCDay()`/`getUTCHours()`/`getUTCMinutes()`/`getUTCSeconds()`/`getUTCMilliseconds()` fold concretely at build time.
   - Multi-argument local constructors `new Date(year, month, ...)` (when `!realm.closedWorld` and no `timezoneOffset` assumption is active), `Date()` called as a function, `Date.parse` / `new Date(str)` on strings without an explicit timezone designator, local getters (`getFullYear`, `getMonth`, `getDate`, `getDay`, `getHours`, `getMinutes`, `getSeconds`, `getMilliseconds`, `getYear`, `getTimezoneOffset`), and local string formatters (`toString`, `toDateString`, `toTimeString`) emit residual runtime expressions instead of baking in the compiler's `TZ`.
   - When `--assume timezoneOffset=<minutes>` is provided, local `new Date(y, m, ...)` and local getters fold concretely under the dual-solstice runtime guard.
2. **Locale-sensitive formatters stay residual:**
   - `Date.prototype.{toLocaleString,toLocaleDateString,toLocaleTimeString}` and `Number.prototype.toLocaleString(locales, options)` forward all locale/options arguments into residual temporal calls rather than crashing with `TODO #1005` or baking in build-host ICU output.
   - `Intl.{NumberFormat,DateTimeFormat,Collator,PluralRules,RelativeTimeFormat,ListFormat,DisplayNames,Segmenter,Locale}` construct residual environment instances whose `.format(...)` / `.select(...)` / `.compare(...)` calls execute against the runtime ICU data.

---

## 3. What Remains Unsolved & Why

1. **Data-dependent loops over open-world strings/collections (`real-world/config-parser-env-override.js`):**
   ```js
   var raw = typeof ENV_CONFIG === "string" ? ENV_CONFIG : "port=8080;debug=false";
   var pairs = raw.split(";");
   for (var i = 0; i < pairs.length; i++) {
     var eq = pairs[i].indexOf("="); // pairs.length is abstract
     ...
   }
   ```
   `raw.split(";")` now produces a typed string-array environment value (`envElementType = StringValue`), which handles `.length`, fixed-index reads (`pairs[0]`), `.join(...)`, and `.filter(Boolean)`. However, imperative `for (var i = 0; i < pairs.length; i++)` loops that mutate outer objects on each iteration depend on Track P1 (`residualLoop.js`) supporting abstract-indexed reads (`pairs[i]`) and mutations inside residualized global loops; today `residualLoop` bails out cleanly with `FatalError PP0037` (`CRASH`, not `WRONG`).

2. **3-way UMD explosion on giant libraries when `--compatibility` is omitted (`lodash` `default`, `moment-timezone` `default`):**
   - When `--compatibility` is omitted (`options: {}`), universal UMD mode evaluates all 3 module-system arms (`CommonJS`, `AMD`, and browser global). On `lodash` (`533 KB`), the CommonJS arm probes `Buffer.isBuffer` and threads a union of environment + user functions into `mixin`'s 300-method loop, hitting `PP0037`; on `moment-timezone` (`913 KB`), the `require('moment')` arm hits `PP0002` on untyped `moment.version` concatenation. Passing `--compatibility browser` (the `browser-opt`, `browser-seed`, and `lazy-objects` profiles) resolves the UMD wrapper cleanly and both `lodash` and `moment-timezone` pass `OK`. Deduplicating UMD `factory` execution across `exports` / `define` / `global` arms (evaluating `factory()` once and branching only the export sink) is the natural next optimization.

3. **Byte-level `TypedArray` loops over abstract `ArrayBuffer`s (`three`, `babel-standalone`):**
   - `new Int32Array(sharedProfilingBuffer)` now residualizes cleanly when an `ArrayBuffer` / `SharedArrayBuffer` comes from an environment constructor (unlocking React 18's `SchedulerProfiling`). However, loops that read/write numeric indices of a concrete `TypedArray` backed by an abstract `$ArrayBufferData` (`three` L454, `babel-standalone` L35867) still abort with `FatalError PP0037` / `PP0001`.

4. **Synchronous host callbacks & microtask queues (`P9-generators-async`):**
   - Asynchronous host schedulers (`setTimeout`, `requestAnimationFrame`, `setImmediate`, `queueMicrotask`) are sound to leave residual because their callbacks cannot run until global initialization finishes. Synchronous callback-accepting host APIs (e.g. custom host hooks or `EventTarget.dispatchEvent` synchronously invoking listeners registered via `addEventListener` during init) and `Promise.prototype.then` microtask draining (`P9-generators-async/promise-then-at-init.js`) require explicit callback havoc/summary modeling and a realm microtask queue (Track P9).
