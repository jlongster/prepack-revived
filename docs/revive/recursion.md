# Track 1E-ii: Recursion Under Abstract Conditions (`P2-recursion`)

## Problem

When a recursive function is called under an abstract condition or with abstract arguments, Prepack previously unrolled the recursion either until `maxStackDepth` (default `112`, failing with `FatalError PP0045: Maximum stack depth exceeded`) or, for branching recursion such as `fib(n)` and `sum(tree)` in pure scope, exponentially until hitting the 30s timeout (`PP0036` / worker timeout).

In `P2-recursion` (13 tests), baseline Prepack passed 2 tests (`concrete-recursion-under-abstract-cond.js` and `issue-543-fib-date-now.js`) and crashed on 11 (8 `PP0045` / `PP0001` crashes and 3 30-second timeouts: `fib-optimized.js`, `gcd-recursive.js`, and `tree-walk-sum.js`).

---

## Why the Old `abstractRecursionSummarization` (`src/methods/call.js`) Failed

`OrdinaryCallEvaluateBody` in `src/methods/call.js` contained a disabled prototype (`const abstractRecursionSummarization = false; // TODO #1586`) with five structural flaws:

1. **Always aborted at the end anyway.** Even after attempting argument widening, `if (F.isSelfRecursive)` unconditionally called `AbstractValue.reportIntrospectionError(F, "call to function that calls itself")` and threw `FatalError`, with a comment `//todo: need to emit a specialized function that temporally captures the heap state at this point`.
2. **Wrong path-condition check (`pathConditions.getLength()`).** `PathConditionsImplementation` chains parent path conditions via `_baseConditions`, and `getLength()` only returns `this._assumedConditions.size` on the innermost frame (almost always `1`), not total path depth. Thus `realm.pathConditions.getLength() > previousPathLength` evaluated `1 > 1 === false` on nested `if`/ternary branches and failed to detect recursion at all.
3. **Keyed by `realm.currentLocation` instead of active `FunctionValue`s.** Mutual recursion (`isEven` / `isOdd`) and recursive calls from two call sites (`fib(n - 1) + fib(n - 2)`) have distinct `currentLocation`s.
4. **Triggered on concrete recursion inside an outer abstract branch.** Checking `!realm.pathConditions.isEmpty()` caused a completely concrete call like `if (abstractCond) ack(2, 3)` to be treated as abstract recursion instead of folding to `9`.
5. **Returned `undefined` at fixpoint.** Returning `realm.intrinsics.undefined` when `Widen.containsArraysOfValue` held corrupted return values (e.g., `n * fact(n - 1)` became `n * undefined` -> `NaN`).

We removed this dead code path from `src/methods/call.js` (and the unused `activeArguments` / `isSelfRecursive` fields on `ECMAScriptFunctionValue`) and replaced it with `src/methods/recursion.js`.

---

## Design (`src/methods/recursion.js`)

### 1. Early Detection & Depth Heuristic

`InternalCall` (`src/methods/function.js`) wraps body evaluation in `withActivation(realm, F, argsList, ...)` and consults `tryResidualizeRecursiveCall(realm, F, thisArgument, argsList)` before pushing a new execution context:

- **Concrete recursion keeps unrolling.** When `F` is re-entered (`stack.length > 0`), we compare `realm.pathConditions` against `stack[stack.length - 1].pathConditions` (object identity on the immutable `PathConditions` chain). If they are identical, no new abstract branch guards the recursive call, so evaluation continues normally. Consequently `if (c) ack(2, 3)` folds completely to `9` without emitting `ack`.
- **Abstract-driven recursion switches immediately.** When `realm.pathConditions !== top.pathConditions`:
  - If any argument is an `AbstractValue`, or the concrete arguments are unchanged from the enclosing activation (e.g. zero-argument closure recursion `expr()` or `immediate(5)`), we emit a residual call immediately at re-entry depth 1 (zero unrolling explosion).
  - If all arguments are concrete and changing (such as module-loader re-entry `require(0)` -> `if (nondet) require(1)`, or bounded concrete countdowns under an abstract check), we allow up to `CONCRETE_UNROLL_LIMIT = 8` nested activations before switching to a residual call.
- **Outermost call speculation (`speculateOutermostCall`).** Without outer-call speculation, `f(n)` calling `fib(n)` would inline one copy of `fib` around two residual calls `fib(n - 1) + fib(n - 2)` (pushing `fib-optimized.js` over the 2x size limit). When `stack` is empty, `F` is part of a call cycle, and `F` receives or captures abstract state (and `F` is not the root function currently being optimized by `__optimize(F)`), we evaluate `F` speculatively inside `evaluateForEffects`. If any nested call residualizes, we discard those effects and emit a single residual call `F(args)` at the outer call site instead.

### 2. Emitting the Residual Call & Ensuring Soundness

A residual call is emitted via `CALL_BAILOUT` (`F(args)` when `thisArgument` is `undefined` or `F` has lexical `this`, and `F.call(thisArgument, ...args)` otherwise). Because the serializer emits residual functions with their **final** heap and binding references, soundness requires different guarantees in pure scope (`__optimize`) versus global code:

#### Pure scope (`realm.isInPureScope() === true`)
1. **Cluster static check (`checkCluster`).** Walks `F` and every `ECMAScriptSourceFunctionValue` reachable through its free variables (both outer and local pure-scope helper bindings): rejects `eval`, `with`, non-normal functions, writes to non-leakable outer variables, and property writes rooted at non-leakable outer variables. Leakability accounts for `TestIntegrityLevel(realm, fn, "frozen")` to match `Leak.value`.
2. **Materialize & havoc (`Leak.value`).** Leaks `F`, `argsList`, and `thisArgument`, which materializes and havocs all reachable objects and mutable bindings created in the current pure scope, then wraps the call in `evaluateWithPossibleThrowCompletion` (preserving `PP0021` diagnostics inside `try`/`catch`).
3. **One-step abstract effect verification (`verifyPureCallEffects`).** Because `Leak.value` only havocs objects and bindings created in the *current* pure scope, a recursive helper could otherwise mutate a pre-existing global object via a method call (`globalArr.push(k)`) or an indirect property read (`var x = sharedObj.inner; x.count++`). After leaking, we run one abstract step of `F` (and any leaked local helper functions in the cluster, whose bindings are now `__leakedValue`) with primitive arguments widened to fresh `AbstractValue`s and verify across all normal and joined-abrupt effect branches that:
   - every modified binding was either created inside the probe or already leaked,
   - every modified property belongs to an object created inside the probe or already leaked (`!obj.mightNotBeLeakedObject()`), and
   - no unverified `FatalError` diagnostic (such as baseline `ForStatement.js`'s `PP0001` bailout) occurred during the probe.

#### Global code (`realm.isInPureScope() === false`)
In global code there is no `Leak.value` havoc mechanism for arbitrary closures, and Prepack continues abstractly interpreting subsequent global statements using the return value of `F(args)`. We enforce four invariants:
1. **No object arguments, `this` object, property writes, `try` block, or global `let`/`const` reads.** Global `let`/`const` bindings (`GlobalEnvironmentRecord.$DeclarativeRecord`) are initialized by the serializer *after* global code runs, so a residual call during global init would observe TDZ / `undefined`; we reject them (`ExceedStackDepth.js`).
2. **Deep read-set snapshot (`Snapshot`).** Every binding, global data property, plain `Object`/`Array` property descriptor, property count, and `$Prototype` reachable from `F`'s cluster is snapshotted (up to `MAX_SNAPSHOT_OBJECTS = 200`), attached to a transactional marker `Binding` so rolled-back speculative paths automatically deactivate their snapshots.
3. **Inductive result-type & purity probe (`proveResultType`).** Evaluates one step of `F` with fresh abstract arguments of the call's types under candidate return types `[NumberValue, StringValue, BooleanValue, PrimitiveValue]`. Assuming recursive calls of matching signature return `T`, verifies that `F` returns a value compatible with `T`, cannot throw (`SimpleNormalCompletion`), modifies no pre-existing or global bindings, and mutates only objects created within that invocation.
4. **Post-execution snapshot check (`checkResidualRecursionSnapshots`).** Runs in `Serializer.init` after global execution finishes and verifies that no active snapshot's bindings, properties, property counts, or prototypes were mutated after the residual call point; otherwise aborts with `FatalError PP0050`.

#### Non-recoverable bailout (`PP0050`)
When any soundness check fails, `reportFailure` emits `FatalError PP0050` with the specific reason and marks the `FatalError` with `isUnsoundResidualRecursionError` so `CallExpression.js`'s `tryToEvaluateCallOrLeaveAsAbstract` rethrows it instead of silently falling back to an equally unsound `CALL_BAILOUT`.

---

## Results

### `P2-recursion` Scoreboard (13 tests)

| Metric | Baseline | After |
|---|---:|---:|
| **PASS** | 2 | **9** |
| **CRASH** | 11 (incl. 3 timeouts) | **4** (0 timeouts) |
| **WRONG** | 0 | **0** |
| **BLOAT** | 0 | **0** |

Tests moved from `CRASH` to `PASS` (7):
- `factorial-under-condition.js` (PP0045 -> PASS, ratio 1.55x)
- `fib-optimized.js` (30s timeout -> PASS, ratio 1.46x)
- `gcd-recursive.js` (30s timeout -> PASS, ratio 1.49x)
- `issue-1586-fibonacci-abstract.js` (PP0045 -> PASS, ratio 1.20x)
- `mutual-recursion-even-odd.js` (PP0045 -> PASS, ratio 1.39x)
- `recursive-path-lookup.js` (PP0045 -> PASS, ratio 1.21x)
- `tree-walk-sum.js` (30s timeout -> PASS, ratio 1.25x)

Already passing and preserved:
- `concrete-recursion-under-abstract-cond.js` (PASS, ratio 0.61x; `ack(2, 3)` still folds to `9` and `ack` is dropped)
- `issue-543-fib-date-now.js` (PASS, ratio 1.05x)

---

## What Remains Unsolved and Why

All 4 remaining `CRASH` cases in `P2-recursion` combine recursion with **loops** (Track 1E-i) or **abstract array/object built-ins** (Track 1D) outside this track's area:

1. **`tree-depth.js` and `descent-parser.js` (blocked on Track 1E-i `loops`).**
   - `tree-depth.js` iterates `for (var i = 0; i < kids.length; i++) depth(kids[i])`; baseline `ForStatement.js` emits `FatalError PP0001` at `i < kids.length` before reaching `depth(kids[i])`.
   - `descent-parser.js` contains three `while (peek() === ...)` loops over an abstract string. Our `analyzeCycle` + `verifyPureCallEffects` handles zero-argument mutual recursion over leaked `pos`/`src`, and intentionally refuses to swallow baseline `ForStatement.js`'s unsound `PP0001` loop recovery. Once Track 1E-i (`residualLoop.js`) merges, sound `for`/`while` loops in pure scope no longer emit `PP0001`, unlocking both tests.

2. **`flatten-recursive.js` (blocked on Track 1E-i `loops` + Track 1D `builtins`).**
   ```js
   function flatten(arr, out) {
     for (var i = 0; i < arr.length; i++) {
       if (Array.isArray(arr[i])) flatten(arr[i], out);
       else out.push(arr[i]);
     }
     return out;
   }
   ```
   Needs both residual `for` loops in pure scope (Track 1E-i) and `Array.isArray` on abstract values without `PP0001` (Track 1D).

3. **`deep-clone.js` (blocked on Track 1D `builtins`).**
   ```js
   function clone(v) {
     if (v === null || typeof v !== "object") return v;
     if (Array.isArray(v)) return v.map(clone);
     var out = {};
     Object.keys(v).forEach(function(k) { out[k] = clone(v[k]); });
     return out;
   }
   ```
   `clone` recurses via callbacks passed to `v.map(clone)` and `Object.keys(v).forEach(...)`. `Array.isArray(v)` currently emits `PP0001` (`src/intrinsics/ecma262/Array.js`), and `Array.prototype.forEach` on a widened temporal array (`src/intrinsics/ecma262/ArrayPrototype.js:637`) emits `UNKNOWN_ARRAY_METHOD_PROPERTY_CALL` without calling `Leak.value(realm, callbackfn)`, leaving `var out = {}` unmaterialized when the callback runs.

4. **Inherent global-code limitations (rejected with `PP0050` by design).**
   - Recursive functions called in **global** code that mutate pre-existing objects/closures, return newly allocated objects whose structure subsequent global code inspects, or read global `let`/`const` bindings (which `ResidualHeapSerializer` emits after global statements) cannot be emitted as plain calls to the final serialized function without full heap-snapshot cloning or statement reordering in the global serializer. They now bail out immediately with a clear `PP0050` diagnostic instead of unrolling 112 frames or miscompiling.
