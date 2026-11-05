# Track F2: Real-World Loop/Built-in Blockers & Residual Heap V8 Performance

## 1. Summary of Outcomes

Track F2 targeted two real-world compilation blockers (`crc-32` and unseeded `redux`) and the V8 execution-speed regressions found by `bench/` (`react-ssr-app` `0.73x` and `acorn` `0.86x` in code-cache mode), then reconciled overlapping serializer changes with Track R3 (`size`).

- **Real-world benchmark (`bench/run.js`, 15 workloads)**:
  - Default-options `OK`: **9 -> 11** (`crc-32` **FAIL -> OK** across all 6 profiles; `redux` **FAIL -> OK** across all 6 profiles).
  - Best-profile `OK`: **11 -> 12**, **0 new `WRONG`**.
  - **`react-ssr-app`**: code-cache `0.73x` -> **`1.60x`** (`0.93 ms -> 0.58 ms`), VM exec `0.72x` -> **`1.60x`**, cold `node` `0.98x` -> **`1.32x`**, gzip `1.38x` -> **`1.11x`** (vs `1.38x` with `Object.create` alone).
  - **`acorn`**: code-cache `0.86x` -> **`1.37x`** (`1.93 ms -> 1.41 ms`), VM exec `0.86x` -> **`1.16x`**, gzip `1.15x` -> **`1.08x`** (vs `1.14x` with `Object.create` alone).
  - **`crc-32`**: **FAIL -> OK** (`1.64x` code-cache, **`2.49x` VM exec**, **`3.11x` cold `node`**).
  - **`redux` (default unseeded)**: **FAIL -> OK** (`1.40x` code-cache, **`1.45x` VM exec**, **`0.87x` gzip**).
- **Hard corpus (`scripts/hard-scoreboard.js`)**:
  - Track F2 alone (`167` tests): `104 PASS / 23 CRASH / 16 WRONG / 24 BLOAT` -> **`107 PASS / 20 CRASH / 16 WRONG / 24 BLOAT`** (`crc32-sequential-loop-leaked-typedarray.js`, `redux-random-split-join.js`, and `real-world/config-parser-env-override.js` all moved **CRASH -> PASS**; `0` new `WRONG`).
  - Merged with `revive` (`171` tests incl. 4 `P9` research tests): **`132 PASS / 19 CRASH / 19 WRONG / 1 BLOAT`** (`100% PASS` on `P1-loops` 21/21, `P2-recursion` 13/13, `P3-joins` 21/21, `P8-size` 9/9, and `real-world` 12/12).

---

## 2. Target 1: `crc-32`, Concrete `TypedArray` Loops, and Residual Loop Havoc

### 2.1 Why Did a Loop with Concrete Bounds Fall Back to `residualizeLoop`?

`ForStatement` has **no** iteration cap on concrete loops. Instead, `crc-32`'s `slice_by_16_tables` failed speculative unrolling on **iteration 0** of `for (n = 0; n != 256; ++n) table[n] = T[n]` with:

```
PP0001: This operation is not yet supported on (some value) at $ArrayBufferData
```

**Root cause:**
1. Track 1E-i wrapped `ForStatement` in `evaluateSpeculatively(() => realm.evaluateForEffects(...))` so failed unrolls can roll back cleanly before calling `residualizeLoop`.
2. `realm.evaluateForEffects` resets `realm.createdObjects = new Set()`. Because `table = new Int32Array(4096)` (and its `$ViewedArrayBuffer`) was allocated *before* the `for` statement, `realm.isNewObject(arrayBuffer)` became `false` inside the loop's `evaluateForEffects`.
3. `SetValueInBuffer` (`src/methods/arraybuffer.js`) called `Properties.ThrowIfInternalSlotNotWritable(realm, arrayBuffer, "$ArrayBufferData")`, which rejected any `ArrayBuffer` where `!realm.isNewObject(arrayBuffer)` because `$ArrayBufferData` was a raw `Uint8Array` not tracked in `realm.modifiedProperties`.

**Companion serializer bug uncovered (`WRONG` hazard):**
`ResidualHeapSerializer._serializeValueTypedArrayOrDataView` (`src/serializer/ResidualHeapSerializer.js`) emitted `new Int32Array(outlinedArrayBuffer)`, ignoring `val.$ByteOffset` and `val.$ArrayLength` (`val.$ByteLength` for `DataView`). Without fixing this, `table.subarray(n * 256, n * 256 + 256)` serialized 15 full-buffer views of length `4096` at offset `0` instead of length `256` at offset `n * 1024`!

**Fixes:**
- **Restorable `$ArrayBufferData` & `$ArrayBufferByteLength` internal slots** (`src/descriptors.js`, `src/methods/arraybuffer.js`, `src/intrinsics/ecma262/ArrayBufferPrototype.js`, `src/methods/join.js`): `AllocateArrayBuffer` installs own tracked slot descriptors backed by `InternalSlotDescriptor` (which clones `Uint8Array` via `.slice(0)` once per enclosing `evaluateForEffects` scope). Concrete loops unroll directly and apply effects; failed speculative unrolls restore exact pre-loop bytes; abstract conditional joins (`Join.joinPropertyBindings`) still report introspection error `PP0001` when two branches produce differing buffer bytes.
- **Exact `TypedArray` / `DataView` view & compact buffer serialization** (`src/serializer/ResidualHeapSerializer.js`): `_serializeValueTypedArrayOrDataView` emits `byteOffset` and `length` (`byteLength` for `DataView`) whenever non-default, and `_serializeValueArrayBuffer` packs non-zero buffers of `>= 64` bytes (`len % 4 === 0`) as `new Uint32Array([...]).buffer` (4x fewer AST literal nodes). Also fixed `TypedArray.js` and `TypedArrayPrototype.js` under `--compatibility jsc-600-1-4-17` where `%TypedArray%` / `%TypedArrayPrototype%` are absent.

### 2.2 Preserving Read-Only Bindings, Reused Counters, and `TypedArray` Types in `residualizeLoop`

When a loop genuinely has an abstract trip count (`src/evaluators/residualLoop.js`, `src/methods/typedarray.js`, `src/values/IntegerIndexedExotic.js`):
1. **Read-only parameters in global code (`collectReadOnlyParams`)**: Enabled `collectReadOnlyParams` in global code (including lexical `DeclarativeEnvironmentRecord` and global `let`/`const` bindings) as well as pure scope, so bindings that the loop only reads (`table`, `T`, `pairs`) are passed as formal parameters to the wrapper closure rather than leaked via `leakBinding`.
2. **Scoped shadowing of uncaptured mutable local counters (`collectShadowBindings`)**: Local mutable variables (`n`, `c`, `v`, `i`) with `!binding.mightHaveBeenCaptured && !state.capturedByInnerFunction.has(name)` are shadowed in `loopEnv` for the synchronous `FOR_STATEMENT_FUNC` call and written back once afterward via `SetMutableBinding(name, GET_BINDING(loopBinding))`. Reassigning `n = 1` before a subsequent concrete loop (`for (n = 1; n != 16; ++n)`) therefore restores a concrete `NumberValue(1)` instead of permanently reading untyped `GET_BINDING`. An inductive syntactic check (`inferNumericLoopBindingKind`) also types numeric/non-negative-integer loop counters during the trial iteration.
3. **Keeping `TypedArray` prototype & element types across leaked buffers**: For read-only `IntegerIndexedExotic` parameters, `leakReadOnlyParamValue` first leaks only `$ViewedArrayBuffer` (retaining `%TypedArrayPrototype%` so post-loop `.subarray(...)` and `.length` still fold concretely, falling back automatically to full `Leak.value` if `checkTrialEffects` sees non-index property mutations). `IntegerIndexedElementGet`, `IntegerIndexedElementSet`, and `IntegerIndexedExotic.{$GetPartial,$SetPartial}` emit `NumberValue`-typed `OBJECT_GET_PARTIAL` reads and runtime index assignments when `$ViewedArrayBuffer` has leaked.

---

## 3. Target 2: Unseeded `redux` & `String.prototype.split` Widened String Arrays

 Evaluating `redux@5.0.1` without `--mathRandomSeed` exposed three chained issues around:

```js
randomString = () => Math.random().toString(36).substring(7).split("").join(".");
ActionTypes = { INIT: `@@redux/INIT${randomString()}`, REPLACE: `@@redux/REPLACE${randomString()}` };
```

1. **`String.prototype.split` summary typing (`src/intrinsics/summaries.js`, `src/values/ArrayValue.js`, `src/intrinsics/ecma262/ArrayPrototype.js`, `src/methods/get.js`)**:
   - Extended `ArrayValue.createTemporalWithWidenedNumericProperty` with `elementType` (default `Value`, reset to `Value` by `recordWidenedMutation()` if mutated) and `isDense`.
   - `stringSplit` now returns a dense widened `ArrayValue` with `elementType = StringValue` in both global and pure scopes (`isPure = true` when coercions are pure; wrapped in `evaluateWithPossibleThrowCompletion` with `isPure = false` otherwise).
   - Enabled widened-array `join`, `slice`, `indexOf`, `lastIndexOf`, and `includes` in global scope whenever element and argument coercions are pure, and refined `GetFromArrayWithWidenedNumericProperty` to return `StringValue` when `Path.implies` proves `0 <= idx < arr.length` on an unmutated dense string array (which also unlocked `real-world/config-parser-env-override.js`).
2. **Abstract ES6 `TemplateLiteral` evaluation (`src/evaluators/TemplateLiteral.js`)**:
   - Upstream `TemplateLiteral.js` called `To.ToStringPartial` (`throwIfNotConcrete()`), crashing on `` `@@redux/INIT${randomString()}` ``. Updated it to build `+` `StringValue` concatenations for pure-`ToString` abstract expressions (and temporal `COERCE_TO_STRING` in pure scope).
3. **Affix-disjoint string equality (`src/utils/simplifier.js`)**:
   - During `createStore`, Redux dispatches `{ type: ActionTypes.INIT }` through user reducers (`if (action.type === "ADD_TODO")`) and compares `action.type === ActionTypes.REPLACE`. Added `areStringsDisjointByAffix` in `simplifyEquality` to fold `===`/`==`/`!==`/`!=` on `StringValue`s whenever concrete prefixes or suffixes disagree or a concrete operand is shorter than the other side's known affix length.

---

## 4. Target 3: Residual Heap V8 Execution Speed & Track R3 Reconciliation

### 4.1 CPU Profiling Root Cause (`react-ssr-app` `0.73x`, `acorn` `0.86x`)

Line-level V8 CPU profiling (`inspector` `Profiler` at `25us` sampling) of `script.runInContext` isolated the bottleneck:
- In **`react-ssr-app`**, **`81.5%` (`3,897 / 4,781` ticks)** of the top-level IIFE ran inside lines `3325..4908`: 145 HTML/SVG `PropertyInfoRecord` instances emitted as `var _4T = (__constructor.prototype = _4W, new __constructor()); _4T.acceptsBooleans = false; ...` (145 prototype reassignments + 1,160 property stores).
- In **`acorn`**, **`79.1%` (`3,238 / 4,096` ticks)** of the top-level IIFE ran inside lines `7450..8600`: 87 `TokenType` and `TokContext` instances emitted via the same `__constructor.prototype = ...` pattern.

Reassigning `__constructor.prototype` in V8 invokes C++ `JSFunction::SetPrototype`, invalidating `initial_map` and breaking hidden-class sharing across instances (degrading downstream `acorn.parse()` and `ReactDOMServer.renderToString` ICs), while emitting properties outside literals prevented `factorifyObjects` from sharing shapes.

### 4.2 Reconciling Object Construction Strategies with Track R3 (`size`)

After merging Track R3 (`revive`), we benchmarked R3's `Object.create(proto)` + `_x.p = v` against `{ __proto__: proto, ... }` literals and shared `function $_ctor(...)` constructors over 60 interleaved V8 `cachedData` runs:

| Workload | Original | R3 (`Object.create` + `_x.p = v`) | `{ __proto__: proto }` + `$_ctor` | **Final 4-Way Hybrid** |
|---|---:|---|---|---|
| **`react-ssr-app`** | 0.77 ms | 0.48 ms (`1.59x`), gz `1.38x` | 0.50 ms (`1.60x`), gz `1.11x` | **0.48 ms (`1.60x`), gz `1.11x`** |
| **`acorn`** | 1.49 ms | 1.26 ms (`1.18x`), gz `1.14x` | 1.21 ms (`1.18x`), gz `1.08x` | **1.24 ms (`1.20x`), gz `1.08x`** |
| **`moment`** | 14.37 ms | 2.97 ms (`4.84x`), gz `1.33x` | 3.09 ms (`4.19x`), gz `1.18x` | **3.03 ms (`4.74x`), gz `1.24x`** |
| **`immutable`** | 1.20 ms | 1.05 ms (`1.15x`), gz `0.99x` | 1.36 ms (`0.95x`), gz `0.97x` | **1.06 ms (`1.13x`), gz `0.99x`** |

**Why the 4-way hybrid wins on both speed and soundness (`ResidualHeapSerializer._shouldUseLiteralProto` + `factorify.js`):**
1. **`>= 4` instances sharing `(proto, keys)` with writable/setter-free prototype chain (`_isInRepeatingConstructorGroup`)**: Emits `{ __proto__: proto, ... }`, which `factorifyObjects` rewrites into a dedicated V8 constructor `function $_0(__0, ...) { this.k = __0; ... }` with `$_0.prototype = _proto;` placed once immediately before the first instance (plus `subFactory` default-argument specialization). V8 allocates slack-tracked in-object properties with a single monomorphic `initial_map` and cuts `react-ssr-app` gzip by **27%** (`1.38x -> 1.11x`).
2. **`< 4` instances with writable/setter-free prototype chain (e.g. `immutable`'s 23 singleton class prototypes)**: Uses R3's `Object.create(proto)` + `_x.p = v`, hitting V8's fast Torque `ObjectCreate` stub instead of `Runtime_InternalSetPrototype` (`1.15x` vs `0.95x` on `immutable`).
3. **Prototype chain has a non-writable property or setter shadowing an own key (`!_canConstructWithThisAssignments`)**: Uses `{ __proto__: proto, k: v }`, which defines own properties via `CreateDataPropertyOrThrow` rather than `[[Set]]`—fixing an upstream silent miscompile (`CustomPrototypeConstructorFactorify.js`) where `var o = Object.create(frozenProto); o.ro = 100;` silently dropped the own property override in non-strict mode!
4. **`proto === null` (`Object.create(null)`)**: Uses `{ __proto__: null, ... }`, compiled by V8 into a constant null-prototype boilerplate without `Object.setPrototypeOf`. Own data properties literally named `"__proto__"` are excluded in `_canEmbedProperty` so they emit `Object.defineProperty`.

---

## 5. Large Workloads: `three` and `@babel/standalone`

Both were blocked by `FatalError PP0037` wrapping `PP0001` on `$ArrayBufferData` inside concrete init loops. The restorable `$ArrayBufferData` slots from §2.1 removed that blocker, and each workload then exposed a chain of further bugs (all fixed on this branch; see `git log revive..rwfix`).

### 5.1 `three@0.187.0` (FAIL -> OK, digest-equal in `vm` and fresh `node`)

After the loop fix, `three` compiled but its output was `WRONG` (`ReferenceError`, then `TypeError`). The causes were all in ES2015 class/generator serialization, which upstream Prepack barely supported:

1. **Generator methods and `async` functions lost their kind** (`function.js`, `properties.js`, evaluators): `*[Symbol.iterator]() {}` class methods were created as ordinary methods, and generator/async flags were not carried into `t.classMethod` / `t.functionExpression`. `FunctionCreate`/`GeneratorFunctionCreate` now take an `isAsync` flag (async functions are non-constructors without `prototype`/`caller`), `PropertyDefinitionEvaluation` handles `kind: "method", generator: true`, and every place in `ResidualFunctions` that builds a function node passes `generator`/`async`. Calling an async function at init is a clean `PP0001` bail-out (the async/await machinery is not modeled), never a silent wrong result.
2. **Class bodies are strict code** (`ClassDeclaration.js`, ECMA-262 10.2.1): methods were created sloppy, so they got own `caller`/`arguments` properties that the serializer then emitted as `Object.defineProperty(_x, "caller", ...)` against a class method (`ReferenceError: _15m`). Methods are now evaluated in `classScope` with `strictCode = true`.
3. **Class method identity** (`ResidualHeapVisitor._visitClass`, `ResidualHeapSerializer._serializeClass`): a method is inlined into the class body only if it is the function stored under that exact key on that class (`homeKey`), with `$HomeObject` matching prototype vs. static. Symbol-keyed and static symbol members are now visited and serialized; setter-only/getter-only accessors no longer serialize the missing half as `undefined` (`withDescriptorValue`), which had produced `prototype.needsUpdate = void 0` and broke the setter. Non-inline prototype assignments are deferred until after the class definition.
4. **Class definition order vs. captured instances** (`ResidualHeapSerializer._serializeValueFunction`): a class constructor's captured bindings may hold instances of the class itself (`var _m3 = new Matrix3()` used inside `Matrix3` methods), and those instances need `Class.prototype` at allocation time. Captured bindings of a class are now serialized *after* the class's insertion point is fixed, and a class waits for its superclass. Class-method residual scopes are initialized inside the method bodies.
5. **Bounded lookup-table reads** (`get.js`): `lut[x & 255]` on a concrete 256-element array of primitives produced a 256-deep conditional expression per read. When `IntervalDomain` proves `0 <= idx < length`, every element is a present data property of a primitive type, and the array is local and unleaked, the read becomes one typed `OBJECT_GET_PARTIAL` and the array is marked final (any later mutation reports `PP0026` instead of silently diverging). Test: `test/serializer/abstract/BoundedLookupTableRead.js` (revive crashes on it).

### 5.2 `@babel/standalone@7.29.13` (FAIL -> OK, digest-equal)

| | revive (before) | rwfix |
|---|---|---|
| Result | `FAIL` (`PP0037`/`PP0001` after ~13 s, 1.05 GB) | **OK**, digest-equal |
| Compile time (default profile) | — | ~51 s |
| Peak RSS (default profile) | — | ~3.5 GB |
| Output | — | 5.30 MB (input 5.25 MB) |

Fixes beyond the loop/TypedArray work:

1. **Annex B `__proto__` in object literals** (`ObjectExpression.js`): `{ __proto__: null, ... }` created an own `"__proto__"` key, so `for (k in legacyPluginAliases)` enumerated an extra `"null"` plugin (`pluginCount` 124 vs 123). (The `env` track landed the same fix; the merge kept a single implementation.)
2. **Residual recursion probes with `null`/`undefined` arguments** (`recursion.js`): probing `f(null)` created an abstract argument of type `NullValue`, violating an `AbstractValue` invariant. Such arguments are now probed as `Value`.
3. **Guarded DOM probes stay inside their guard** (`HeapInspector`/`ResidualHeapSerializer`, `properties.js`): `typeof document !== "undefined" && document.documentElement && ...` produced atemporal property reads on a partial object that the serializer hoisted into `var _yU = document.documentElement;` *outside* the `&&` guard, throwing in Node. Atemporal property reads created under a non-empty path condition get kind `property:?<name>` and are always serialized inline, never hoisted.
4. **Objects rolled back during construction** (`ObjectValue` tracked-slot setter): writes to tracked internal slots while an object is still being constructed are no longer recorded as undoable modifications. Previously a speculative rollback could reset a still-reachable object's `_isLeaked` slot to `undefined` (crash in `leak.js` after ~4.5 min).
5. **Call depth** (`realm.js`, hot shared file): the default `maxStackDepth` is now 160 instead of 112. Babel's init legitimately nests 121 calls deep (`new State()` inside parser plugin construction); the old limit raised `PP0045`, which then made the enclosing loop fall back to residualization and ended in an internal error. `test/error-handler/stackOverflow.js` still reports `PP0045`.
6. **Visitor cost was quadratic** (`ResidualHeapVisitor._mark`): the heap visitor recorded one scope entry per (value, referencing residual function) pair, so values shared by thousands of Babel functions were revisited thousands of times (4.25 M visits and still running after 8 minutes). When there are no optimized functions and `--debugScopes` is off, a value already reachable from the global generator does not need further scopes from functions that are themselves reachable from the global generator: `_getTarget` flattens such function scopes back to the global generator, so the target body is unchanged. Visiting finishes in seconds.

## 6. What Remains Unsolved & Next Steps

1. **1-argument table-builder recomputation (`crc-32` `slice_by_16_tables(T0)`)**:
   `crc-32` now compiles and runs **2.49x faster** in VM exec (`3.11x` cold `node`), but materializes 4,352 32-bit CRC constants (`22.5 KB` gzip vs `0.8 KB` source) because Track R3's `recompute.js` currently tracks 0-argument factory calls (`signed_crc_table()`) and single-loop global array/object builders, whereas `slice_by_16_tables(T0)` is a 1-argument helper returning an array of 15 `Int32Array.subarray` views. Extending `FunctionRecomputeRecipe` to pure $k$-argument calls whose arguments are already residual values would let `crc-32` choose between `3.6 KB` source size and `2.5x` precomputed lookup speed.
2. **Remaining 3 `FAIL` / 1 `WRONG` workloads in `bench/` (owned by sibling tracks)**:
   - `handlebars-app` (`WRONG`, `PP0023`): missing `globalThis` + `Object.prototype.__defineGetter__` (`P7` / `PP0023` severity).
   - `underscore` (`FAIL` default, `OK` under `jsc`): `document.childNodes` DOM model (`P7`, Track 2B).
   - `d3-scale` (`FAIL`, `serialized 1339 of 1341`): `class InternMap extends Map` superclass serialization (`ResidualFunctions` default-param blocker was resolved by R3).
   - `marked` (`FAIL`, `PP1004` + `PP0022`): `optionalCatchBinding` parser plugin and `static get` class getters.
