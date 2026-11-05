# Track 2C (R3): Output Size & Specialization Cost Model (`P8`)

## 1. Overview & Headline Results

Upstream Prepack suffered from severe code-size explosion (`P8`): unrolling table-initialization loops into multi-kilobyte literals, duplicating helper functions across abstract branches (`#2140`), emitting verbose descriptor/constructor boilerplate for `Error` and prototype objects, keeping unobservable intermediate binding/global writes (`#2011`, `#2337`), cloning curried wrappers that touch `arguments`, and materializing self-retaining library factories (`lodash.runInContext`) alongside the factory source itself. On modern V8, that extra code size directly penalized parse/compile time, making Prepacked `lodash` **3.16x larger (Terser) / 2.07x larger (gzip)** and **slower on cold start (`0.74x`)** than the original library.

We implemented three complementary layers—**(1) Serializer, Peephole & Dead-State Optimizations**, **(2) a Provenance-Guided Re-computation & Curried-Factory Cost Model**, and **(3) Pure-Scope Inlining Control**—without modifying or weakening `scripts/hard-scoreboard.js`'s size metric or any existing test markers.

### Hard Corpus Summary (`node scripts/hard-scoreboard.js`)

| Scope | Baseline (`revive`) | Final (`size`) | Delta |
|---|---|---|---|
| **Original 159-test corpus** | 104 PASS / 16 CRASH / 15 WRONG / **24 BLOAT** | **128 PASS** / **15 CRASH** / **15 WRONG** / **1 BLOAT**\* | **+24 PASS, -1 CRASH, 0 new WRONG, -23 BLOAT** |
| **Full 167-test corpus** *(incl. `real-world-libs/`)* | 104 PASS / 23 CRASH / 16 WRONG / **24 BLOAT** | **129 PASS** / **21 CRASH** / **16 WRONG** / **1 BLOAT**\* | **+25 PASS, -2 CRASH, 0 new WRONG, -23 BLOAT** |
| **`P8-size` (9 tests)** | 2 PASS / 1 CRASH / 0 WRONG / 6 BLOAT | **9 PASS / 0 CRASH / 0 WRONG / 0 BLOAT** | **100% PASS** |
| **`P1-loops` (21 tests)** | 20 PASS / 1 BLOAT | **21 PASS / 0 BLOAT** | **100% PASS** |
| **`P2-recursion` (13 tests)** | 12 PASS / 1 BLOAT | **13 PASS / 0 BLOAT** | **100% PASS** |
| **`P3-joins` (21 tests)** | 16 PASS / 5 BLOAT | **21 PASS / 0 BLOAT** | **100% PASS** |
| **Aggregate output bytes** *(non-crashing 159-corpus tests)* | **88,822 B** (`2.042x` of 43,506 B input) | **52,880 B** (`1.203x` of 43,943 B input) | **-40.5% total output bytes** |

\* *Zero size-ratio `BLOAT` cases remain anywhere in the 167-test corpus.* The single remaining `BLOAT` classification is `P4-paths/infeasible-branch-pruning.js` (size ratio `1.20x <= 2.0x`), which fails its `P4` solver goal marker `// does not contain:unreachable` on an untyped parameter `x` (`x > 5 => x > 3`).

### Real-World Benchmark Summary (`bench/run.js`, Terser + Gzip + Node v26.7.0)

| Workload | Baseline Terser Ratio | Final Terser Ratio | Baseline Gzip Ratio | Final Gzip Ratio | Cold `node` Speedup (Base -> Final) | V8 Code-Cache Speedup (Base -> Final) | VM Exec Speedup (Base -> Final) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **`lodash`** | 3.16x (218.1 KB) | **1.05x (72.3 KB)** | 2.07x (50.7 KB) | **0.97x (23.7 KB)** | 0.74x -> **0.95x** | 1.41x -> 0.98x | 1.58x -> 1.02x |
| **`ramda`** | 2.54x (133.8 KB) | **1.23x (64.8 KB)** | 1.62x (22.9 KB) | **1.08x (15.2 KB)** | 1.21x -> 0.86x\* | 1.32x -> **2.16x** | 1.55x -> **2.30x** |
| **`underscore`** *(jsc)* | 1.84x (34.8 KB) | **1.73x (32.7 KB)** | 1.11x (8.0 KB) | **1.10x (7.9 KB)** | 0.87x -> 0.53x\* | 1.16x -> 1.04x | 1.06x -> **1.08x** |
| **`react-ssr-app`** | 1.76x (79.4 KB) | **1.70x (76.6 KB)** | 1.38x (21.0 KB) | **1.38x (21.0 KB)** | 0.98x -> **1.31x** | 0.73x -> **1.64x** | 0.72x -> **1.70x** |
| **`acorn`** | 1.43x (164.8 KB) | **1.41x (163.1 KB)** | 1.15x (38.8 KB) | **1.14x (38.7 KB)** | 1.03x -> 0.57x\* | 0.86x -> **1.75x** | 0.86x -> **1.70x** |
| **`moment`** | 1.21x (352.3 KB) | **1.19x (347.4 KB)** | 1.34x (99.2 KB) | **1.33x (99.1 KB)** | 0.89x -> **1.02x** | 3.49x -> **4.20x** | 3.38x -> **4.86x** |
| **`yaml-router-app`** | 1.15x (59.4 KB) | **1.13x (58.6 KB)** | 1.05x (18.1 KB) | **1.05x (18.0 KB)** | 1.56x -> **1.92x** | 2.61x -> **3.13x** | 2.51x -> **3.18x** |
| **`preact-ssr-app`** | 1.04x (22.0 KB) | **1.02x (21.7 KB)** | 1.02x (8.8 KB) | **1.00x (8.7 KB)** | — | 1.24x -> **1.31x** | 1.28x -> **1.33x** |
| **`chroma-js`** | 0.99x (42.2 KB) | **0.94x (40.0 KB)** | 0.96x (14.7 KB) | **0.93x (14.3 KB)** | 1.05x -> **2.02x** | 1.07x -> **1.07x** | 1.08x -> **1.16x** |
| **`immutable`** | 0.97x (62.8 KB) | **0.97x (62.9 KB)** | 1.00x (17.9 KB) | **0.99x (17.9 KB)** | 0.69x -> **0.87x** | 1.11x -> **1.13x** | 1.12x -> **1.10x** |
| **`redux`** *(seed)* | 0.87x (7.7 KB) | **0.87x (7.7 KB)** | 0.89x (3.0 KB) | **0.89x (3.0 KB)** | — | 1.42x -> **1.45x** | 1.57x -> **1.48x** |

\* *Note on sub-10ms cold `node` net measurements:* `coldNet` subtracts median `node -e 0` (~37 ms, p90 ~50 ms) from total child-process wall time, so workloads whose actual load time is < 8 ms (`underscore`, `ramda`, `acorn`, `preact-ssr-app`) have ±4 ms OS spawn jitter; `V8 cachedData` and `VM Exec` provide low-noise sub-millisecond measurements.

---

## 2. Strategy Designs & Soundness Decisions

### Strategy 1: Serializer, Peephole & Dead-State Optimizations

#### 1.1 Compact Native `Error` Serialization & `.stack` Observability Decision
- **Problem:** Every `new Error(msg)` (and `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `URIError`, `EvalError`) was serialized via `var __constructor = function() {}; (__constructor.prototype = Error.prototype, new __constructor())` plus two `Object.defineProperty` calls (`message` and a multi-line build-time `stack` string). This caused **7 of the 24 BLOAT cases** (`P3-joins/*` 4, `fuzz/*` 3) and produced plain objects lacking the `[[ErrorData]]` internal slot (`Object.prototype.toString.call(e)` returned `"[object Object]"` instead of `"[object Error]"`).
- **Design (`Error.js`, `HeapInspector.js`, `ResidualHeapVisitor.js`, `ResidualHeapSerializer.js`):**
  - Tag the synthesized stack value at construction time (`O.$ErrorData.defaultStack = stackVal`).
  - Keep `O.stack` populated in Prepack's heap during evaluation so Prepack's own `PP0023` diagnostics and any init-time `.stack` reads continue to see the full Prepack trace.
  - At serialization time, for extensible unleaked instances of the 7 standard error prototypes:
    - Emit `new Ctor(msg)` when `message` has its default `{ writable: true, enumerable: false, configurable: true }` descriptor and known `StringValue` type, or `new Ctor()` when `"message"` is absent (`new Error()` leaves own `"message"` absent, matching ECMA-262 19.5.1.1).
    - **Observability decision on `.stack`:** `Error.prototype.stack` / own `.stack` formatting is non-standard and host-engine-specific in ECMA-262. When `err.stack` still equals `O.$ErrorData.defaultStack` with default attributes, we omit serializing the build-time `.stack` literal and let the runtime host's `new Ctor(...)` lazily populate a native `.stack` (preserving `typeof err.stack === "string"`, `"stack" in err`, and non-enumerability while restoring genuine `[[ErrorData]]` so `Object.prototype.toString.call(err) === "[object Error]"`). If user code explicitly overwrote or deleted `err.stack` (e.g. `err.stack = "custom"`), `desc.value !== defaultStack` and the mutation is serialized faithfully via `defineProperty` / `delete`.

#### 1.2 Expression & Function Inlining by Default, `factorifyObjects` (`#884`), and `Object.create`
- **`inlineExpressions` enabled by default** (`prepack-options.js`, `prepack-cli.js`) whenever `lazyObjectsRuntime === undefined`.
- **Single-use top-level function inlining** (`ResidualHeapSerializer._inlineSingleUseTopLevelFunctions`): inlines single-reference `var _f = function(...) {}` declarations into top-level assignments (`this.f = function(...) {}`), accounting for both `Identifier` and `JSXIdentifier` references and preserving relative AST DFS function ordering.
- **Recursive `factorifyObjects` (`#884`, `factorify.js`):** extended `factorifyObjects` to traverse into `ArrayExpression` elements and nested `ObjectExpression` property values so `inlineExpressions: true` does not defeat object-factory extraction on arrays of similar objects.
- **`Object.create(proto)` over `__constructor`** (`ResidualHeapSerializer._serializeValueObjectViaConstructor`): when not targeting legacy mobile JSC (`jsc-600-1-4-17` / `mobile`), emit `Object.create(proto)` (~7B per call) instead of `var __constructor = function() {}; (__constructor.prototype = proto, new __constructor())` (~46B per call + 28B prelude). Beyond shrinking `P6-havoc/issue-2226-setter-on-prototype.js`, avoiding repeated `.prototype` mutation on a shared dummy constructor improved V8 hidden-class behavior enough to flip `acorn` VM exec from `0.86x` -> **`1.70x`** and `react-ssr-app` from `0.72x` -> **`1.70x`**. *(Note for integration: overlaps cleanly with Track F2 `rwfix`'s residual heap construction area.)*
- **Named `FunctionExpression`s & `__originalName` preservation** (`FunctionExpression.js`, `VariableDeclaration.js`, `ResidualFunctions.js`, `ResidualHeapSerializer.js`): fixed two upstream bugs where `FunctionExpression` omitted `closure.__originalName = name` and `VariableDeclaration` overwrote existing `__originalName`s (causing 272 bogus `Object.defineProperty(fn, "name", $$0)` calls in `lodash` and 258 in `ramda`), and embedded explicit valid-identifier function names directly on `function <name>(...)` syntax.
- **Repeated-character string runs** (`ResidualHeapSerializer._serializeStringValue`): compresses runs of `>= 24` identical characters into `"x".repeat(n)` when `String.prototype.repeat` is unmodified and target compatibility allows ES6 (`P8-size/string-builder-unrolled.js`: `5.57x` -> `1.48x`).
- **Single-scope direct lazy closure capture** (`Referentializer.js`): when `invariantLevel === 0` and a scope container has only a single captured scope (`capturedScopeInstanceIdx === 1`), emit `var __scope_0; ... __scope_0 || (__scope_0 = [...])` directly instead of generating `__get_scope_binding_0` + `switch (__selector)` + `new Array(1)` (`P6-havoc/issue-2012-havoc-binding-capture.js`: `2.42x` -> `1.64x`).

#### 1.3 Dead Unobservable State Pruning (`#2011`, `#2337`) & Algebraic/Type Refinements
- **Dead intermediate `BindingAssignmentEntry` & `GLOBAL_ASSIGNMENT` pruning** (`Generator._pruneRedundantEntries` in `generator.js`):
  - Eliminates `BindingAssignmentEntry(b, v1)` overwritten by a subsequent `BindingAssignmentEntry(b, v2)` with only intervening binding reads/writes (`#2011`: `1.53x` -> `1.20x`), and forwards known binding assignments into immediately following `GET_BINDING` entries (`SINGLE_ARG`). *(Carefully restricted not to skip across `TemporalOperationEntry`s marked `isPure: true` such as `Array.prototype.map`, whose callbacks can still read captured bindings.)*
  - Eliminates overwritten intermediate `GLOBAL_ASSIGNMENT` entries in contiguous runs of global assignments (removing 999 dead `this.i = k` lines in `unrolled-table-1000.js` and 255 dead `this.c` / `this.ch` lines in `lookup-table-char-classes.js`, cutting `lookup-table-char-classes.js` from `7.73x` -> `1.33x`).
- **Unused call return bindings** (`TemporalOperationEntry.serialize`): omits `var _$0 = ` on unreferenced call statements (`g(_C);` instead of `var _$0 = g(_C);`).
- **Conditional `__empty` peephole & `dummyProperties` tail elision** (`AbstractValue.promoteEmptyToUndefined`, `ResidualHeapSerializer._getPropertyAssignmentStatement` & `serializeValueRawObject`):
  - Distributes `promoteEmptyToUndefined()` over `"conditional"` `AbstractValue`s (`(c ? 1 : __empty)` -> `c ? 1 : void 0` instead of `((c ? 1 : __empty) === __empty) ? void 0 : (c ? 1 : __empty)`).
  - Avoids materializing dead `var _6 = _9 ? true : __empty` and `var __empty = {}` when `_getPropertyAssignmentStatement`'s conditional peephole or generator `pathConditions` narrows the branch, and omits dummy `{ prop: void 0 }` + `else delete obj.prop` whenever no subsequent property is embedded inline in the object literal.
- **String concatenation associativity, `typeof` conditional distribution & path refinement, and pure-scope `UnaryExpression` recovery** (`simplifier.js`, `to.js`, `AbstractValue.js`, `UnaryExpression.js`):
  - Folds `(X + "a") + "b" -> X + "ab"` and `"a" + ("b" + Y) -> "ab" + Y` (100% ECMA-262 equivalent when both merged constants are `StringValue`s).
  - Distributes `typeof (c ? x : y)` when at least one branch has a known `typeof` string, refines `To.GetToPrimitivePureResultType` and `createFromConditionalOp` under assumed `typeof v === "..."` path conditions, and aligns pure-scope `UnaryExpression` (`+`, `-`, `~`) with `BinaryExpression` so untyped unary operations emit temporal expressions instead of `RecoverableError PP0008` (`P8-size/issue-2140-inlining-explosion.js`).

---

### Strategy 2: Specialization / Re-computation Cost Model & Curried Factories

#### 2.1 Curried Function Factories (`ResidualFunctions.js`)
- **Problem:** `ResidualFunctions._shouldUseFactoryFunction` rejected any function with `usesArguments === true` (because flat factories `function $_0(cap1, p1, p2)` shift `arguments.length` and `arguments[i]`), crashed with `FatalError: TODO: do not know how to deal with non-Identifier parameters` on default/rest/destructured parameters (`d3-scale`), and could not share self-named function expressions (`function f2(a, b) { ... return f2; }` in `ramda`'s `_curry1`/`_curry2`/`_curry3`). In `ramda`, this cloned 1,892 curried functions (`2.54x` Terser).
- **Design:** Emit curried factories `var $_0 = function(cap1, ...) { return function f2(params...) { ... }; };` and instantiate via `$_0(arg1, ...)` (hoisted in topological order to the end of `prelude` when all differing arguments are primitives or prelude functions, verified by a fixed-point check so `mainBody`-bound values like `NativeFunctionValue` aliases or `BoundFunctionValue`s are never referenced before initialization).
  - Preserves `arguments`, dynamic `this`, `fn.length`, `.prototype`, constructibility (`new fn()`), self-bindings `f2`, and arbitrary ES6 parameter patterns—strictly dominating `.bind()` (`TODO #2589`).
  - **Impact:** Unblocks `real-world-libs/d3-scale-default-param-factory.js` (`CRASH` -> `PASS`), cuts `ramda` raw size by **60%** (`342.9 KB` -> `135.3 KB`, Terser `2.54x` -> **`1.23x`**, gzip `1.62x` -> **`1.08x`**) while **doubling** `ramda`'s V8 code-cache (`2.16x`) and VM execution (`2.30x`) speedups!

#### 2.2 Provenance-Guided Re-computation Cost Model (`src/methods/recompute.js`)
- **Key Insight:** Aborting loop/factory evaluation *early* during abstract interpretation would havoc the container and destroy constant folding for downstream init-time reads (and prevent dead-code elimination if the table is never needed at runtime!). Instead, we **evaluate concretely as normal**, record provenance recipes on pure 0-arg calls (`evaluateCallWithRecomputeTracking` in `function.js`) and isolated global container-building `for`/`while` loops (`prepareLoopRecomputeBeforeApply` / `finalizeLoopRecomputeAfterApply` in `ForStatement.js`), and decide at **serialization time** whether to emit the materialized heap or re-emit the computing code.
- **Soundness Verification (`getVerifiedRecomputeRecipes` + `ResidualHeapVisitor._visitRecomputeTarget`):**
  1. **Purity during execution:** No modified outer declarative bindings, no modified pre-existing objects (ignoring Prepack's internal `__checkedBindings` and idempotent descriptor writes such as `re.lastIndex = 0 -> 0`), and no impure generator entries (only `GLOBAL_ASSIGNMENT`s on loop counters or unused `isPure` temporals).
  2. **Post-creation immutability & free-variable stability:** Snapshots the output object graph and all outer bindings/globals/objects read by the function/loop AST; if subsequent global init code mutates the table (e.g. `MUTATED[0] = 999`) or rebinds a free dependency, the recipe is invalidated and normal heap serialization runs. (Self-initialization `var _ = runInContext();` where `_` transitions from `undefined` during the call to `retObj` after the call is explicitly modeled and verified.)
  3. **Zero interior-alias loss:** A fixpoint watcher in `ResidualHeapVisitor` verifies that no interior object `inner !== target` in `effects.createdObjects` is referenced from outside `target` (e.g. `var alias = SHARED_ITEMS[0]`); if any interior object is visited externally, recomputation is canceled and `target` is materialized normally, preserving exact object identity (`alias === SHARED_ITEMS[0]`).
- **Two-Regime Cost Model (`estimateCreatedGraphCost`):**
  Let $S_{\text{code}}(F)$ be the producer AST size and $S_{\text{data}}(G)$ be the estimated serialized byte size of the created object graph $G$:
  1. **Self-retaining factory ($F \in \text{Reachable}(G)$, e.g. `lodash`'s `runInContext`, retained via `_.runInContext` and `realNames`):** Materializing $G$ pays $S_{\text{code}}(F) + S_{\text{data}}(G \setminus \{F\})$, whereas emitting `F()` pays $S_{\text{code}}(F) + O(1)$. Recompute whenever $S_{\text{data}}(G \setminus \{F\}) > 512\text{ B}$. On `lodash`, this eliminates ~330 KB raw / ~146 KB Terser of duplicated closures, shrinking `lodash` from **`3.16x` -> `1.05x` Terser** and **`2.07x` -> `0.97x` gzip**!
  2. **One-shot producer ($F \notin \text{Reachable}(G)$, e.g. `crc32-table` vs `moment`):** Materializing $G$ drops $F$ and saves $T_{\text{exec}}(F)$ at startup. Recompute *only* under severe data expansion: $S_{\text{data}}(G) > \max(2.2 \cdot S_{\text{code}}(F), S_{\text{code}}(F) + 250\text{ B})$ (and $2.0\times$ / $+150\text{ B}$ for global init loops). Thus `crc32-table` (`16x` expansion -> `1.20x`), `unrolled-table-1000` (`70.8x` -> `1.30x`), and `repeated-defaults-objects` (`6.3x` -> `1.21x`) recompute as compact loops, whereas `moment` (`~1.0x` ratio) stays materialized and keeps its **`4.86x` VM execution speedup**!

---

### Strategy 3: Pure-Scope Inlining Control (`src/methods/inlining.js`, `recursion.js`, `NewExpression.js`)

In `__optimize` pure scopes (when `!realm.react.enabled` and `!realm.instantRender.enabled`), we guard against inlining bloat using `tryEmitPureResidualCall`—which reuses `recursion.js`'s `checkCluster` + `Leak.value` + 1-step abstract `verifyPureCallEffects` prover, and **cleanly rolls back to normal inlining** (never emitting `PP0050` errors) if a helper mutates outer non-leakable state:
1. **Call-site count × body-size cap (`#2140`):** For helpers with `bodyBytes >= 100` called with abstract arguments where `staticCalls >= 4` (or `dynamicCalls >= 3`) and `calls * bodyBytes >= 750`, emit residual calls `F(arg)` instead of duplicating `F`'s branching body across every call site (`P8-size/issue-2140-inlining-explosion.js`: `8.38x` -> `1.58x`).
2. **Global-retained loop-bailing helpers (`#1959`):** When a helper `F` (`bodyBytes >= 240`) is already retained on `$GlobalObject`, called with all-abstract arguments, and speculative specialization still emits a `FOR_STATEMENT_FUNC` residual loop plus `>= 3` temporal operations, emit a residual call `F(args)` rather than duplicating both `F` and a second specialized loop (`P1-loops/issue-1959-shallow-equal.js`: `2.47x` -> `1.16x`).
3. **Recursive self-reference & concrete-to-abstract transition guards (`recursion.js`):** In `speculateOutermostCall`, if evaluating a recursive function `F` on abstract inputs still passes `F` itself into residual generator operations (such as `v.map(clone)` in `deep-clone.js`), emit the outer call `clone(cfg)` residually (`2.22x` -> `1.13x`). Similarly, when an active concrete recursive walk (such as `renderToString` on concrete vnodes in `react-like-render.js`) transitions to an untyped non-conditional `AbstractValue` child (`props.title`), residualize at that boundary while still folding concrete and conditional vnodes (`3.31x` -> `1.59x`).
4. **Conditionally-throwing global constructors inside `try` (`NewExpression.js`):** Inside a `try` block in pure scope, if `new C(abstractArgs)` on a globally-retained constructor `C` throws conditionally with isolated effects, emit `new C(args)` inside the residual `try` block instead of unrolling constructor allocation, conditional property deletes, and error construction (`P3-joins/throw-in-constructor.js`: `4.77x` -> `1.86x`).

---

## 3. Incremental Strategy Progression

| Step | Commit | Hard Corpus (159-test base) | Aggregate Corpus Bytes | Key Real-World / Target Impact |
|---|---|---|---:|---|
| **0. Baseline (`revive`)** | `9faa01ca` | 104 PASS, 16 CRASH, 15 WRONG, **24 BLOAT** | 88,822 B (`2.042x`) | `lodash` 3.16x Terser (2.07x gz), `ramda` 2.54x Terser |
| **1A. Serializer & dead-state wins** | `20a3cf3b` | 117 PASS, 16 CRASH, 15 WRONG, **11 BLOAT** | 64,419 B (`1.481x`) | **-13 BLOAT** (all 7 `Error` tests, `#2011`, `string-builder`, `lookup-table`, `P4` x2, `P7` x1); **-27.5% corpus bytes** |
| **1B. Closures, single-use fns, `typeof`/string** | `b96dfc92` | 119 PASS, 15 CRASH, 15 WRONG, **10 BLOAT** | 64,324 B (`1.464x`) | `#2012` & `#2286` -> PASS; `#2140` CRASH -> BLOAT (`0` P8 crashes) |
| **2A. Curried function factories** | `7d00b3e6` | 120 PASS (incl. `d3-scale-default-param`), **10 BLOAT** | 64,324 B (`1.464x`) | **`ramda` Terser `2.54x -> 1.23x` (gz `1.08x`, VM `2.30x`)**; `lodash` Terser `3.05x -> 2.36x` |
| **2B/2C. Re-computation cost model** | `a03723b9` | 122 PASS (123/167), **7 BLOAT** | 57,818 B (`1.316x`) | **`lodash` Terser `2.36x -> 1.05x` (gz `0.97x`)**; `crc32-table`, `unrolled-table-1000`, `repeated-defaults` -> PASS; `moment` keeps `4.86x` VM speedup |
| **3. Inlining control + `Object.create`** | `bdb264b9`, `3538c3f0` | **128 PASS (129/167), 1 BLOAT\*** | **52,880 B (`1.203x`)** | `#2140`, `#1959`, `deep-clone`, `throw-in-constructor`, `#2226`, `react-like-render` -> PASS; `acorn` VM `0.86x -> 1.70x`; `react-ssr-app` VM `0.72x -> 1.70x` |

### Per-Test Before/After on All 25 `P8-size` & Baseline `BLOAT` Tests

| Test | Input (B) | Baseline Status & Size | Final Status & Size |
|---|---:|---|---|
| `P8-size/unrolled-table-1000.js` | 171 | BLOAT — 12,105 B (`70.79x`) | **PASS — 222 B (`1.30x`)** |
| `P8-size/crc32-table.js` | 330 | BLOAT — 3,053 B (`9.25x`) | **PASS — 397 B (`1.20x`)** |
| `P8-size/issue-2140-inlining-explosion.js` | 437 | CRASH (`PP0008`, 3,664 B / `8.38x`) | **PASS — 689 B (`1.58x`)** |
| `real-world/lookup-table-char-classes.js` | 444 | BLOAT — 3,433 B (`7.73x`) | **PASS — 589 B (`1.33x`)** |
| `P8-size/repeated-defaults-objects.js` | 290 | BLOAT — 1,835 B (`6.33x`) | **PASS — 350 B (`1.21x`)** |
| `P8-size/string-builder-unrolled.js` | 138 | BLOAT — 769 B (`5.57x`) | **PASS — 204 B (`1.48x`)** |
| `P3-joins/throw-in-constructor.js` | 304 | BLOAT — 1,450 B (`4.77x`) | **PASS — 565 B (`1.86x`)** |
| `fuzz/throw-in-call-argument-join.js` | 335 | BLOAT — 1,178 B (`3.52x`) | **PASS — 453 B (`1.35x`)** |
| `P3-joins/global-conditional-throw-then-work.js` | 345 | BLOAT — 1,142 B (`3.31x`) | **PASS — 523 B (`1.52x`)** |
| `real-world/react-like-render.js` | 797 | BLOAT — 2,639 B (`3.31x`) | **PASS — 1,270 B (`1.59x`)** |
| `P3-joins/issue-2561-throw-before-constructor.js` | 420 | BLOAT — 1,309 B (`3.12x`) | **PASS — 638 B (`1.52x`)** |
| `P3-joins/catch-rethrow-abstract.js` | 380 | BLOAT — 1,048 B (`2.76x`) | **PASS — 607 B (`1.60x`)** |
| `P6-havoc/issue-2226-setter-on-prototype.js` | 267 | BLOAT — 682 B (`2.55x`) | **PASS — 490 B (`1.84x`)** |
| `P1-loops/issue-1959-shallow-equal.js` | 757 | BLOAT — 1,868 B (`2.47x`) | **PASS — 877 B (`1.16x`)** |
| `P6-havoc/issue-2012-havoc-binding-capture.js` | 289 | BLOAT — 700 B (`2.42x`) | **PASS — 474 B (`1.64x`)** |
| `fuzz/path-implies-both-true-visitor.js` | 375 | BLOAT — 870 B (`2.32x`) | **PASS — 476 B (`1.27x`)** |
| `P2-recursion/deep-clone.js` | 416 | BLOAT — 925 B (`2.22x`) | **PASS — 468 B (`1.13x`)** |
| `P3-joins/return-in-nested-function-conditional-objects.js` | 282 | BLOAT — 622 B (`2.21x`) | **PASS — 394 B (`1.40x`)** |
| `fuzz/conditional-inner-throw-outer-alternate.js` | 389 | BLOAT — 859 B (`2.21x`) | **PASS — 371 B (`0.95x`)** |
| `P4-paths/typeof-refinement.js` | 389 | BLOAT — 811 B (`2.08x`) | **PASS — 633 B (`1.63x`)** |
| `P4-paths/comparison-chain-numbers.js` | 249 | BLOAT — 505 B (`2.03x`) | **PASS — 425 B (`1.71x`)** |
| `P7-environment/math-random-init.js` | 129 | BLOAT — 260 B (`2.02x`) | **PASS — 190 B (`1.47x`)** |
| `P8-size/issue-2286-cse-effectful.js` *(max 1.5x)* | 149 | BLOAT — 236 B (`1.58x`) | **PASS — 205 B (`1.38x`)** |
| `P8-size/issue-2011-binding-writes.js` *(max 1.5x)* | 178 | BLOAT — 272 B (`1.53x`) | **PASS — 213 B (`1.20x`)** |
| `P8-size/residual-closure-drags-code.js` | 265 | PASS — 359 B (`1.35x`) | **PASS — 329 B (`1.24x`)** |
| `P8-size/issue-2220-empty-if.js` | 129 | PASS — 108 B (`0.84x`) | **PASS — 73 B (`0.57x`)** |
| `P4-paths/infeasible-branch-pruning.js` | 164 | BLOAT (`contains "unreachable"`, `1.57x`) | BLOAT (`contains "unreachable"`, `1.20x`) |

---

## 4. Metric Note: Babel Compact (`hard-scoreboard.js`) vs. Terser (`bench/run.js`)

We kept `scripts/hard-scoreboard.js`'s `minifiedSize` metric (`@babel/generator` with `{ comments: false, compact: true, minified: true }`) **completely unchanged** so every `PASS` above holds under the exact original baseline bar. Comparing both metrics in `bench/run.js` shows an important distinction:
- Babel's compact printer strips comments and whitespace, so raw identifier count (`var _0 = ...; var _1 = ...;`) directly inflates `hard-scoreboard` ratios when inputs are short snippets.
- Terser (`bench/run.js`) mangles identifiers, merges `var` declarations, and folds trivial constants, exposing **structural** bloat (duplicated closures, materialized data tables, unminifiable `Object.defineProperty` descriptors). Our curried factories (`ramda` `2.54x -> 1.23x`) and recomputation cost model (`lodash` `3.16x -> 1.05x`) specifically attack structural bloat that Terser cannot recover.

---

## 5. What Remains Unsolved & Why (with Minimal Examples)

1. **CSE across potentially side-effecting `ToPrimitive` coercions (`#2286` untyped variant):**
   ```js
   var o = {};
   function f(x) {
     o.x = x + 1;
     return [o, x + 1];
   }
   ```
   When `x` is an untyped parameter (`Value`), `x` may be `{ c: 0, valueOf() { return ++this.c; } }`, for which `f(x)` must call `valueOf()` **twice** and return `[{ x: 2 }, 3]`. Merging the two temporal `x + 1` evaluations without a primitive type proof is unsound; `issue-2286-cse-effectful.js` passes (`1.38x <= 1.5x`) via expression and single-use function inlining while preserving exact two-coercion semantics.

2. **Residual runtime library retention in `react-ssr-app` (`1.70x` Terser, `1.38x` gzip, `1.70x` VM speedup):**
   `react-ssr-app` evaluates `ReactDOMServer.renderToStaticMarkup(<App />)` into a constant `bootHtml` string **and** exports `React`, `ReactDOMServer`, and `App` on `globalThis` for runtime calls. Consequently, the bundle must contain *both* the pre-rendered HTML string and the residual `react` + `react-dom/server` libraries. Removing the renderer requires either dead-export elimination (not exporting `ReactDOMServer`) or whole-bundle tree-shaking (`#2141`–`#2143`).

3. **Method-installer loops mutating non-empty objects (`underscore` `1.73x` Terser under `jsc`, `acorn` `1.41x` Terser):**
   - `underscore` only runs under `--compatibility jsc-600-1-4-17` until Track P7 models `document.childNodes`; in `jsc-600-1-4-17` mode Prepack intentionally disables ES6 `Object.create` and named-function `.name` configurability assumptions, and `underscore`'s `mixin(allExports)` loop mutates the `prototype` of `_` after `_` already has own properties.
   - `acorn` defines dozens of parser methods on `Parser.prototype` across multiple IIFE modules (`pp$1.parseTopLevel = ...`) and uses prototype getters (`Object.defineProperty(pp, "inFunction", { get: ... })`) rather than object literals; emitting compact ES6 `{ get inFunction() {} }` syntax is only possible on fresh object literals, not cross-module prototype mutations.

4. **Multi-statement or impure table-initialization loops:**
   ```js
   var A = [], B = [];
   for (var i = 0; i < 500; i++) { A.push(i); B.push(i * 2); }
   ```
   `prepareLoopRecomputeBeforeApply` currently restricts loop recomputation to loops populating a **single** initially-empty global `Array` or plain `Object` (`A` *or* `B`, not two containers simultaneously) and rejects loops whose outputs are subsequently mutated (`MUTATED[0] = 999`). Extending `LoopRecomputeRecipe` to tuple targets `(A, B)` plus post-loop delta replay (`MUTATED[0] = 999` emitted after the loop) is a clean follow-up.
