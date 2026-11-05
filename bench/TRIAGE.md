# Real-World Corpus Triage (`bench/`)

Measured on `lib/prepack-node.js` (`0.2.55-alpha.0`, branch `bench` from `revive` after Phase 1 merges: `loops`, `recursion`, `joins`, `ranges`, `builtins`, `fuzz`) on Node `v26.7.0`.

Reproduce:

```sh
node bench/setup.js                                    # build bench/libs/dist/*.js + manifest.json
node bench/run.js --prepack lib/prepack-node.js        # full option sweep + 30-run perf harness
node bench/run.js --prepack lib/prepack-node.js --no-perf   # fast triage-only sweep (~18s)
node scripts/hard-scoreboard.js --filter real-world-libs --verbose
```

---

## 1. Per-Library Status Overview (15 Workloads)

- **Default options (`--compatibility browser`)**: **9 OK**, **1 WRONG** *(critical silent miscompile)*, **5 FAIL**, **0 TIMEOUT**.
- **Best option profile**: **11 OK**, **1 WRONG**, **3 FAIL**, **0 TIMEOUT** (`redux` unlocked by `--mathRandomSeed 0`; `underscore` unlocked by `--compatibility jsc-600-1-4-17`).

| Workload | Package(s) & Version | License | Kind | Default | Best | Best Profile | Primary / Default Blocker | Area |
|---|---|---|---|---|---|---|---|---|
| **`handlebars-app`** | `handlebars@4.7.10` | MIT | app | **WRONG** | **WRONG** | — | `PP0023` warning only -> emits unconditional `throw TypeError("not an object")` (`globalThis` missing + `Object.prototype.__defineGetter__` unimplemented) at `handlebars.js:2665:53` | `environment` + `serializer` |
| **`crc-32`** | `crc-32@1.2.2` | Apache-2.0 | lib | **FAIL** | **FAIL** | — | `FatalError PP0037` (wrapping `PP0002`) at `crc32.js:57:2` (`slice_by_16_tables` sequential loops over `Int32Array`) | `loops` + `havoc` (P1/P6) |
| **`d3-scale`** | `d3-scale@4.0.3`, `d3-array@3.2.5`, `internmap@2.0.3` (+5) | ISC | lib | **FAIL** | **FAIL** | — | Undiagnosed `FatalError: TODO: do not know how to deal with non-Identifier parameters` (`ResidualFunctions.js:689`); ES2015-lowered hits `Invariant Violation` on `class InternMap extends Map` | `serializer` + `language-feature` |
| **`marked`** | `marked@18.1.3` | MIT | lib | **FAIL** | **FAIL** | — | `FatalError PP1004` (`optionalCatchBinding` at `marked.umd.js:13:1309`); ES2015-lowered hits `FatalError PP0022` on `static get rules()` class getter | `language-feature` + `serializer` |
| **`underscore`** | `underscore@1.13.8` | MIT | lib | **FAIL** | **OK** | `jsc` | Default `browser` & `node-react` fail with `FatalError PP0001: This operation is not yet supported on document at childNodes` (`underscore-umd.js:139:35`) | `environment` (P7) |
| **`redux`** | `redux@5.0.1` | MIT | app | **FAIL** | **OK** | `browser-seed` | Default (unseeded `Math.random()`) fails with `FatalError PP0031: property access on unknown object` on `Math.random().toString(36).substring(7).split("").join(".")` | `havoc` / `builtins` (P6) + `environment` (P7) |
| **`lodash`** | `lodash@4.18.1` | MIT | lib | **OK** | **OK** | `default` | Passes (1.41x code-cache speedup; **2.07x gzip / 3.16x Terser size bloat**; `jsc` fails with `PP0001`) | `size` (P8) |
| **`ramda`** | `ramda@0.32.0` | MIT | lib | **OK** | **OK** | `default` | Passes (1.32x code-cache speedup; **1.62x gzip / 2.54x Terser size bloat**) | `size` (P8) |
| **`immutable`** | `immutable@4.3.9` | MIT | lib | **OK** | **OK** | `default` | Passes (1.11x code-cache speedup; 1.00x gzip) | — |
| **`moment`** | `moment@2.31.0` (`moment-with-locales`) | MIT | lib | **OK** | **OK** | `default` | Passes (**3.49x code-cache speedup**, 14.06ms -> 4.03ms; 1.34x gzip) | — |
| **`chroma-js`** | `chroma-js@2.4.2` | BSD-3-Clause AND Apache-2.0 | lib | **OK** | **OK** | `default` | Passes (1.07x code-cache speedup; **0.96x gzip**) | — |
| **`acorn`** | `acorn@8.19.0` | MIT | lib | **OK** | **OK** | `default` | Passes (0.86x VM speed, 1.15x gzip — descriptor/closure overhead) | `size` (P8) |
| **`preact-ssr-app`** | `preact@10.29.0`, `preact-render-to-string@6.6.7` | MIT | app | **OK** | **OK** | `default` | Passes (1.24x code-cache speedup, 1.02x gzip; **WRONG `PP0023` under `node-react` & `jsc`**) | — |
| **`react-ssr-app`** | `react@18.3.1`, `react-dom@18.3.1` | MIT | app | **OK** | **OK** | `default` | Passes (folds `bootHtml` at build time; 0.73x VM speed, 1.38x gzip; **WRONG `PP0023` under `jsc`**) | `size` (P8) |
| **`yaml-router-app`** | `js-yaml@4.3.2`, `mustache@4.2.0` | MIT | app | **OK** | **OK** | `default` | Passes (**2.61x code-cache speedup**, **1.56x cold `node` speedup**, 1.05x gzip) | — |

---

## 2. Ranked Blockers (by Severity & Blast Radius)

### Rank 1 (CRITICAL — `WRONG` silent miscompile, blocks `handlebars-app` in all 6 profiles + UMD bundles in `node-react`/`jsc`)
**Top-level uncaught init exceptions serialized as `throw err;` with only `Warning PP0023` + missing `globalThis` & `Object.prototype.__defineGetter__`**
- **Blocked corpus items**:
  1. **`handlebars-app`** (all 6 option profiles -> **`WRONG`**)
  2. **`preact-ssr-app`** under `node-react` and `jsc` -> **`WRONG`**
  3. **`react-ssr-app`** under `jsc` -> **`WRONG`**
- **PP code**: `Warning PP0023` (`Program may terminate with exception: ...`) — **no `FatalError` or `RecoverableError` is emitted**, so Prepack exits `0` and writes a 2 KB bundle that unconditionally throws on startup!
- **Prepack area**: `environment` / `intrinsics` (`P7`) + `serializer` (`PP0023` severity).
- **Hard-corpus test**: `test/serializer/hard/real-world-libs/handlebars-globalthis-definegetter.js`
- **Minimal repro**:
  ```js
  (function() {
    if (typeof globalThis === "object") return;
    Object.prototype.__defineGetter__("__magic__", function() { return this; });
    __magic__.globalThis = __magic__;
    delete Object.prototype.__magic__;
  })();
  globalThis.App = { ok: true };
  ```
- **Root cause in `src/`**:
  1. `src/intrinsics/ecma262/global.js` defines `global`, `window`, and `self` (in `browser`), **not ES2020 `globalThis`**.
  2. `handlebars` (and many webpack/core-js bundles) falls into Mathias Bynens's `globalThis` polyfill, calling `Object.prototype.__defineGetter__` (ECMA-262 Annex B.2.2), which is missing from `src/intrinsics/ecma262/ObjectPrototype.js`.
  3. `Serializer.init` (`src/serializer/serializer.js`) logs an unconditional `AbruptCompletion` (`ThrowCompletion`) of the entire entry script as a `Warning` (`PP0023`) instead of `FatalError`/`RecoverableError`, silently turning any unmodeled feature-detection crash into a broken output bundle.
  4. **Verified follow-up**: Prepending `var globalThis = global;` lets the entire `handlebars-app` (including `Handlebars.compile(...)` of partials/helpers at module init!) compile and pass with **0 diagnostics**!
  5. *(Related UMD hazard in `node-react`)*: `src/intrinsics/fb-www/global.js` defines global `module` (`module.exports`) as an `AbstractObjectValue`, causing UMD wrappers (`preact.min.umd.js`) to export into `module.exports` instead of `global.preact`, so subsequent scripts reading `global.preact` throw `TypeError` -> `PP0023` (`WRONG`).

---

### Rank 2 (Blocks 2 libraries in ES2015 class code: `d3-scale` + `marked`)
**Incomplete ES2015 `class` serialization (`class extends Map/Set` invariant crash & `PP0022` on class getters/setters)**
- **Blocked corpus items**:
  1. **`d3-scale`** (via `internmap`: `class InternMap extends Map`)
  2. **`marked`** (when ES2015-lowered past `optionalCatchBinding`: `class _Lexer { static get rules() { ... } }` + `Map` subclass/references)
- **PP codes**:
  - `Invariant Violation: serialized X of Y` (`visited but not serialized values: [object], intrinsic name: Map`)
  - `FatalError PP0022: a class method incorrectly went through the serializeValue() code path`
- **Prepack area**: `serializer` / `language-feature`.
- **Hard-corpus tests**:
  - `test/serializer/hard/real-world-libs/d3-internmap-class-extends-map.js`
  - `test/serializer/hard/real-world-libs/marked-class-static-getter.js`
- **Minimal repros**:
  ```js
  // Repro A (Invariant Violation: serialized 3 of 4)
  class InternMap extends Map {}
  global.InternMap = InternMap;

  // Repro B (FatalError PP0022)
  class Lexer { static get rules() { return 42; } }
  global.Lexer = Lexer;
  ```
- **Root cause in `src/`**:
  - In Repro A, `ResidualHeapVisitor` visits `InternMap`'s `$Prototype` (`%Map%`), adding `Map` to `visitedValues`, while `ResidualHeapSerializer`'s class emitter fails to serialize/mark the intrinsic superclass constructor (`src/serializer/ResidualHeapSerializer.js:2233`).
  - In Repro B, `ClassMethod` nodes with `kind: "get" | "set"` become property-descriptor `get`/`set` `ECMAScriptSourceFunctionValue`s whose `$ECMAScriptCode` is a `ClassMethod` rather than `FunctionExpression`. `emitDefinePropertyBody` calls `serializeValue()`, which explicitly aborts with `PP0022` (`src/serializer/ResidualHeapSerializer.js:919`).

---

### Rank 3 (Blocks `d3-scale` published UMD + modern ES2015+ bundles)
**`ResidualFunctions.spliceFunctions` crashes on non-`Identifier` parameters (default, rest, destructuring)**
- **Blocked corpus items**: **`d3-scale`** (all 6 profiles on published UMD scripts).
- **PP code**: None (`UNDIAGNOSED_FATAL` — throws raw `new FatalError("TODO: do not know how to deal with non-Identifier parameters")` without calling `realm.handleError`, which also trips `prepack-cli.js:449`'s invariant!).
- **Prepack area**: `serializer` / `language-feature` (`P8`).
- **Hard-corpus test**: `test/serializer/hard/real-world-libs/d3-scale-default-param-factory.js`
- **Minimal repro**:
  ```js
  function makeLinearScale(domainStart, scaleFactor) {
    return function scale(value = 0) {
      var shifted = value - domainStart;
      var scaled = shifted * scaleFactor;
      return Math.round(scaled * 100) / 100;
    };
  }
  global.s1 = makeLinearScale(10, 2.5);
  global.s2 = makeLinearScale(0, 0.5);
  ```
- **Root cause in `src/`**:
  When two or more closures share an AST body large enough to factor out into a shared factory function (`src/serializer/ResidualFunctions.js:687-691`), `spliceFunctions` generates a forwarding wrapper `function(params) { return factory.call(this, ...captured, ...params); }` and requires `param.type === "Identifier"`, crashing on `AssignmentPattern` (`x = 0`), `RestElement` (`...args`), `ObjectPattern`, or `ArrayPattern`.

---

### Rank 4 (Blocks `marked` published UMD + any ES2019+ bundle)
**Outdated `@babel/parser` plugin list in `src/utils/parse.js` (`PP1004`)**
- **Blocked corpus items**: **`marked`** (`lib/marked.umd.js:13:1309`, all 6 profiles).
- **PP code**: `FatalError PP1004: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBinding'`
- **Prepack area**: `language-feature`.
- **Hard-corpus test**: `test/serializer/hard/real-world-libs/marked-optional-catch-binding.js`
- **Minimal repro**:
  ```js
  global.ok = (function() {
    try { return !!new RegExp("(?<=1)a"); } catch { return false; }
  })();
  ```
- **Root cause in `src/`**:
  `src/utils/parse.js:30` hardcodes `let plugins = ["objectRestSpread"];` for `@babel/parser` 7.0. Even syntax that `@babel/parser@7.0.0` already supports (`optionalCatchBinding`, `asyncGenerators`, `numericSeparator`, `optionalChaining`, `nullishCoalescingOperator`, `classProperties`) is not enabled in `plugins` (and `TryStatement.js` assumes `ast.handler.param` is non-null if `optionalCatchBinding` is enabled).

---

### Rank 5 (Blocks `underscore` under default `--compatibility browser` and `node-react`)
**Incomplete DOM `document` mock (`document.childNodes` throws `PP0001`)**
- **Blocked corpus items**: **`underscore`** (`underscore-umd.js:139:35`, 5 of 6 profiles — works only in `jsc` where `document` is absent).
- **PP code**: `FatalError PP0001: This operation is not yet supported on document at childNodes`
- **Prepack area**: `environment` (`P7-environment` — direct target for Track 2B type-driven DOM models).
- **Hard-corpus test**: `test/serializer/hard/real-world-libs/underscore-document-childnodes.js`
- **Minimal repro**:
  ```js
  var nodelist = global.document && global.document.childNodes;
  global.isFn = typeof nodelist !== "function";
  ```
- **Root cause in `src/`**:
  `src/intrinsics/dom/document.js` creates `document` from a non-partial template `ObjectValue` with 11 method stubs and `body`, then wraps it via `createAbstract(realm, document, "document")`. Any property access not in those 12 keys (such as `document.childNodes`, `document.documentElement`, `document.head`, `document.nodeType`, `document.cookie`) hits `OrdinaryGetOwnProperty` on an abstract non-partial template and aborts with `PP0001`.

---

### Rank 6 (Blocks `redux` under default unseeded options)
**`String.prototype.split` summary loses `Array` prototype (`.join` fails with `PP0031` after unseeded `Math.random()`)**
- **Blocked corpus items**: **`redux`** (fails `default` and `browser-opt`; passes once `--mathRandomSeed 0` makes `Math.random()` concrete).
- **PP code**: `FatalError PP0031: property access on unknown object`
- **Prepack area**: `havoc` / `builtins` (`P6-havoc`, Track 1D) + `environment` (`P7`).
- **Hard-corpus test**: `test/serializer/hard/real-world-libs/redux-random-split-join.js`
- **Minimal repro**:
  ```js
  var id = "@@redux/INIT" + Math.random().toString(36).substring(7).split("").join(".");
  global.hasPrefix = id.slice(0, 12) === "@@redux/INIT";
  ```
- **Root cause in `src/`**:
  Track 1D (`src/intrinsics/summaries.js`) added an effect summary for `String.prototype.split` with `resultType: ObjectValue` rather than `ArrayValue` (or an array-shaped abstract value whose prototype is `%ArrayPrototype%`). When `Redux.combineReducers` / `createStore` generates its init action token without `--mathRandomSeed`, `.split("")` returns a generic `ObjectValue`, and `.join(".")` immediately aborts in `AbstractObjectValue.$Get` with `PP0031`!

---

### Rank 7 (Blocks `crc-32` across all 6 profiles)
**`residualizeLoop` in global code permanently leaks read-only `TypedArray` and reused counter bindings to untyped `Value` (`PP0037` / `PP0002`)**
- **Blocked corpus items**: **`crc-32`** (`crc32.js:48-60`, all 6 profiles).
- **PP code**: `FatalError PP0037: failed to emit a residual loop: the loop calls an unknown or unsupported function in global code (PP0002: might be an object with an unknown valueOf or toString or Symbol.toPrimitive method)`
- **Prepack area**: `loops` + `havoc` (`P1-loops` / `P6-havoc`, Track 1E-i).
- **Hard-corpus test**: `test/serializer/hard/real-world-libs/crc32-sequential-loop-leaked-typedarray.js`
- **Minimal repro**:
  ```js
  var T0 = new Int32Array(256);
  function sliceBy16Tables(T) {
    var c = 0, v = 0, n = 0, table = new Int32Array(4096);
    for (n = 0; n != 256; ++n) table[n] = T[n];
    for (n = 0; n != 256; ++n) {
      v = T[n];
      for (c = 256 + n; c < 4096; c += 256) v = table[c] = (v >>> 8) ^ T[v & 0xff];
    }
    var out = [];
    for (n = 1; n != 16; ++n) out[n - 1] = table.subarray(n * 256, n * 256 + 256);
    return out;
  }
  global.TT = sliceBy16Tables(T0);
  ```
- **Root cause in `src/`**:
  1. `sliceBy16Tables(T0)` is 100% concrete (zero abstract inputs), yet the nested loop (`256 * 15 = 3,840` total inner iterations) exceeds `ForStatement`'s concrete unrolling cap and falls back to `residualizeLoop` (`src/evaluators/residualLoop.js`).
  2. In global code (`!realm.isInPureScope()`), `leakForGlobalCode` leaks *every* local binding referenced by the loop — including `table` (which is **never reassigned**, only mutated at indices `table[c]`) and `n` — setting `binding.hasLeaked = true` permanently and returning untyped `Value` (`GET_BINDING`) on every subsequent read.
  3. On line 57 (`for (n = 1; n != 16; ++n) out[n - 1] = table.subarray(...)`), even after `n = 1` assigns concrete `1`, reading `n` still produces untyped `Value` (`PP0002` on `n != 16`), forcing line 57 into `residualizeLoop` too, where `table.subarray(...)` on untyped `table` triggers `CALL_BAILOUT` and aborts with `PP0037`!

---

## 3. Code-Size & Speed Regressions on Passing Libraries (Targets for Track 2C `P8-size`)

Even where Prepack produces **correct (`OK`)** output, three passing workloads show clear size/parse-time tradeoffs for Track 2C's cost model:

1. **`lodash`**: V8 code-cache execution is **1.41x faster** (`3.67 ms -> 2.60 ms`, VM exec-only **1.58x**), **but** Terser-minified size grows **3.16x** (`69.0 KB -> 218.1 KB`) and gzip grows **2.07x** (`24.5 KB -> 50.7 KB`) because Prepack unrolls Lodash's compact loop-driven method-installer (`baseForOwn` over method maps) into ~300 explicit function/property definitions. Consequently uncached cold `node` startup is **0.74x** (`24.52 ms -> 33.21 ms`).
2. **`ramda`**: V8 code-cache execution is **1.32x faster** (`1.14 ms -> 0.86 ms`, VM exec-only **1.55x**), while Terser size grows **2.54x** (`52.6 KB -> 133.8 KB`, gzip **1.62x**) from materializing `_curry1`/`_curry2`/`_curry3` wrapper closures individually instead of keeping `_curryN` calls.
3. **`react-ssr-app`**: Prepack folds the build-time `ReactDOMServer.renderToString(...)` call into a static HTML literal, **but** materializing `React` + `ReactDOMServer`'s internal object graph expands Terser size **1.76x** (`45.1 KB -> 79.4 KB`, gzip **1.38x**) and slows VM execution to **0.73x** (`0.95 ms -> 1.29 ms`).
