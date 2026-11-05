# Track 1A: Control-Flow Joins and Completions (`P3`)

## Summary of Changes

We fixed the silent miscompiles and crashes in Prepack's control-flow join machinery (`src/completions.js`, `src/methods/join.js`, `src/realm.js`, `src/evaluators/{LabeledStatement,SwitchStatement,TryStatement,NewExpression}.js`, `src/methods/properties.js`, `src/utils/simplifier.js`, `src/utils/generator.js`, `src/serializer/{ResidualOperationSerializer,ResidualHeapVisitor}.js`).

On `P3-joins` (`node scripts/hard-scoreboard.js --filter P3-joins`):

| Metric | Baseline (`revive`) | After Track 1A |
|---|---:|---:|
| **PASS** | 9 | **15** |
| **CRASH** | 7 | **1** |
| **WRONG** | 3 | **0** |
| **BLOAT** | 2 | **5** (3 moved from CRASH to BLOAT) |

`P4-paths/issue-2355-truthiness-return.js` also moved from `WRONG` to `PASS`.

---

## Root Causes Found and Fixed

### 1. Unscoped `realm.savedCompletion` across `LabeledStatement`, `SwitchStatement`, and `TryStatement`
When an `if` branch executes an abrupt completion (`return`, `throw`, `break`, `continue`) under an abstract condition and the other branch falls through, `Realm.composeWithSavedCompletion` stashes a `JoinedNormalAndAbruptCompletions` in `realm.savedCompletion` and captures subsequent side effects so they can be predicated on the normal path at the next join point.

Two symmetric bugs existed at statement boundaries:
1. **Missing join on exit:** `LabeledStatement` (`P3-joins/labeled-block-break.js`, fuzzer `labeled-break-before-throw-call.js`) and concrete-discriminant `SwitchStatement` never called `incorporateSavedCompletion` + `normalizeSelectedCompletions` when their body completed normally with a pending `savedCompletion`. A conditional `break label;` or `break;` was left inside `realm.savedCompletion` and silently discarded or leaked into `call.js:processResult`.
2. **Missing isolation on entry:** `TryStatement` called `incorporateSavedCompletion` at the end of `ast.block` without saving and clearing `realm.savedCompletion` on entry (`fuzzer/throw-before-try-catch-finally.js`). A conditional `throw` *before* `try { ... } catch (e) {}` was absorbed into `blockRes` and caught by the `try`'s own `catch` handler. Similarly, a conditional `return` inside `catch` was not joined before `finally`, skipping `finally` side effects on the early-return path.

**Fix:** Added `Realm.evaluateCompletionInSavedCompletionScope(f)` and used it at `LabeledStatement`, `SwitchStatement`, and `TryStatement` (`try`, `catch`, and `finally`) boundaries. Also removed the arbitrary `cases.length < 6` cap in `SwitchStatement` (#1378).

### 2. Truthiness joins returning non-boolean condition values (#2354 variant, #2355)
Joining `return true` and `return false` produces `AbstractValue.createFromConditionalOp(realm, cond, true, false)`, which calls `simplifier.js` with `isCondition = false`. Two rules in `src/utils/simplifier.js` erased the boolean conversion:
- `c ? true : false` returned `c` unconditionally (even when `isCondition` was `false` and `c.getType() !== BooleanValue`, e.g. `0`, `""`, `NaN`).
- `c ? false : true` called `AbstractValue.createFromUnaryOp(realm, "!", c, true, loc, true)` with `isCondition = true` hardcoded, so `!(!a)` simplified back to `a`.

**Fix:** Return `makeBoolean(realm, c, loc)` (`!!c`) for `c ? true : false` when `!isCondition && c.getType() !== BooleanValue`, and pass `isCondition` instead of `true` in `c ? false : true`.

### 3. `evaluateWithAbstractConditional` dropping normal-branch values when paired with throws (#2561, fuzzer seed 1105)
`JoinedNormalAndAbruptCompletions` extends `NormalCompletion` and initializes `this.value` to `consequent instanceof NormalCompletion ? consequent.value : alternate.value` — picking *only the first* normal child's value. When `a ? "A" : g()` (or a conditional call `var h = a ? A : B; h(b);`, or `new C()` on a conditional constructor) could throw inside `g()`/`B`, `effects.result` was `JoinedNormalAndAbruptCompletions(a, SimpleNormal("A"), JoinedNormalAndAbrupt(threw, Throw(e), SimpleNormal("B")))`, whose `.value` was `"A"`. `evaluateWithAbstractConditional` returned `returnOrThrowCompletion(effects.result)`, evaluating the entire expression to `"A"` even when `a` was `false` and `g()` succeeded!

**Fix:** In `Realm.evaluateWithAbstractConditional` (and `Generator._generatorOfEffects`), compute `Join.joinValuesOfSelectedCompletions(c => c instanceof SimpleNormalCompletion, completion)` before composing `completion` into `realm.savedCompletion`. Also split conditional constructors in `NewExpression.js` (#2561) via `evaluateWithAbstractConditional`.

### 4. Asymmetric object leaking across branches (`nested-returns-side-effects.js`)
`_joinBindings` ensured that if a variable binding leaked in one branch of a join, it was leaked and materialized in the other branch too. `joinEffects` did *not* do the same for objects (`_isLeaked`). When an object leaked in one branch only (e.g. `log.join("")` bailing out inside an `if`), the other branch kept stale tracked properties; a subsequent leak re-materialized those stale properties and overwrote mutations made by residual code.

**Fix:** In `JoinImplementation.joinEffects`, detect objects leaked on only one side and run `Leak.value` on the other side's effects before joining property bindings.

### 5. Residual `try/catch` for unmodeled throws in pure scope (PP0021, TODO #1264, #2120)
Previously:
- Property reads/writes/deletes/defines on leaked objects (`o.foo = 42; return o.bar;`) did not call `reportPossibleThrowInsideTry`, silently erasing enclosing `catch` handlers when a getter or setter threw (#2120).
- Calls to `evaluateWithPossibleThrowCompletion` inside a `try` in pure scope emitted `PP0021: Possible throw inside try/catch is not yet supported`.

**Fix:**
1. Report possible throws on leaked-object property accesses/writes/deletes/defines in `src/methods/properties.js`.
2. Added a `TRY_CATCH` generator operation serialized as:
   ```js
   var _$caught;
   try {
     /* serialized block generator */
   } catch (e) {
     _$caught = [e];
   }
   ```
   (Wrapping `e` in a 1-element array distinguishes `throw undefined` from normal completion without an extra boolean temporary.)
3. Before evaluating the `try` block for residual emission, pre-existing local bindings and pure-scope-tracked objects mutated inside the `try` block are leaked so all mutations emit in program order inside `try { ... }` and `catch` reads their exact runtime state at the throw point. Modeled `ThrowCompletion`s inside the `try` block are emitted as residual `throw` statements inside the same `try` block.
4. `try B catch (e) H finally F` is desugared to `try { try B catch (e) H } finally F` so both modeled and unmodeled throws inside `H` still execute `F`.
5. Fixed `Join.joinValuesOfSelectedCompletions` to pass `keepInfeasiblePaths` into its recursive calls (previously omitted, causing nested conditional throws to lose inner guards), and updated `CONDITIONAL_THROW` not to materialize dead conditional `AbstractValue`s or unused `__empty` sentinels.

### 6. `Join.mapAndJoin` with `NaN`, `SwitchStatement` abrupt joins, `composeCompletions`, and `GET_BINDING` visiting (fuzzer P3 bugs)
- `SwitchStatement` and `ArrayPrototype.map` call `Join.mapAndJoin` with `v => switchValue === v`. When `switchValue`'s domain contained `NaN` (`switch (a ? NaN : 0) {}`), `switchValue === NaN` folded to concrete `false`, tripping `invariant(condition instanceof AbstractValue)` and losing the `NaN` arm. `mapAndJoin` now treats `NaN` as the complement of all non-`NaN` elements and handles conditions that fold to concrete booleans or `InfeasiblePathError`.
- `SwitchStatement`'s `DefiniteCaseEvaluation` called `realm.composeWithSavedCompletion(result)` on a `JoinedAbruptCompletions` (which is a no-op when `result` has no normal arm) and returned `empty`, silently swallowing `if (!a) throw 0; else return 0;` inside an abstract `switch` (`fuzzer` seed 500514), and tripped `invariant(result instanceof Value)` when an infeasible `break` simplified to `SimpleNormalCompletion` (seed 501004). Normalizing unlabeled `BreakCompletion`s and delegating to `realm.returnOrThrowCompletion` fixes both, as well as labeled `break` inside an abstract `switch`.
- `Join.composeCompletions` chained `rightCompletion.composedWith = leftCompletion` whenever both were `JoinedNormalAndAbruptCompletions`, even when `leftCompletion.savedEffects === undefined` (such as `composeResults` in `try/finally`), causing a later `incorporateSavedCompletion` to crash in `stopEffectCaptureAndUndoEffects` (seed 500340) or drop `finally`'s conditional throws (seed 502077). Chaining `.composedWith` is now restricted to `leftCompletion.savedEffects !== undefined`, falling back to tree composition otherwise.
- `TemporalOperationEntry.visit` now notifies `ResidualHeapVisitor` (`visitLeakedBinding`) on `GET_BINDING`, fixing an invariant failure in `ResidualHeapSerializer.serializeBinding` whenever a local binding whose pre-leak value was `undefined` was leaked and later read without any `BindingAssignmentEntry`.

---

## What Remains Unsolved in P3 (and Why)

1. **`P3-joins/nested-returns-side-effects.js` (`CRASH`, PP0001 — recovered output is now correct):**
   Fails inside `Array.prototype.push` because after a conditional `log.push("a")`, `log.length` is the conditional abstract value `a ? 1 : 0`, and `ToLength` in `ArrayPrototype.push` rejects abstract lengths (`P5-ranges`, owned by Track 1C). Once `Array.prototype.push` supports bounded abstract lengths (or non-leaking array summaries), the join itself already produces the exact right output.
2. **Outer/global object mutation inside residual `try/catch` (`PP0021` fallback):**
   Minimal example:
   ```js
   let outer = { x: 1 };
   function f(g) {
     try {
       outer.x = 2;
       return g();
     } catch (e) {
       return outer.x;
     }
   }
   ```
   Because `outer` was allocated outside `f`'s pure scope, `Leak.value` refuses to havoc `outer` (doing so would invalidate global heap knowledge). Rather than let `catch` silently read a wrong value, `TryStatement` bails out cleanly with `PP0021`.
3. **Output size on `Error`-throwing tests (4 `BLOAT` cases in `P3-joins`):**
   `catch-rethrow-abstract.js`, `global-conditional-throw-then-work.js`, `issue-2561-throw-before-constructor.js`, and `throw-in-constructor.js` are semantically `PASS` with no diagnostics, but exceed the 2x size ratio because `ResidualHeapSerializer` materializes every `new Error(...)` via `__constructor`, `Object.defineProperty` descriptors, and full multi-line `.stack` string literals (`P8-size`). `return-in-nested-function-conditional-objects.js` (2.54x) similarly duplicates object allocation boilerplate across branches (`P8-size`).

---

## Design Verdict: Patch the 10 Completion Classes or Replace Them?

`src/completions.js` currently defines 10 classes:
`Completion`, `NormalCompletion`, `SimpleNormalCompletion`, `AbruptCompletion`, `ThrowCompletion`, `ContinueCompletion`, `BreakCompletion`, `ReturnCompletion`, `JoinedAbruptCompletions`, and `JoinedNormalAndAbruptCompletions`.

### Why this design was so bug-prone (concrete evidence from Track 1A)
1. **Control flow is split across three mechanisms at once:**
   - JavaScript host exceptions (`throw abruptCompletion`) for unconditional `AbruptCompletion`s,
   - Normal JS return values for `SimpleNormalCompletion` *and* `JoinedNormalAndAbruptCompletions` (which subclasses `NormalCompletion` specifically so it will not be thrown!),
   - Ambient mutable state on `Realm` (`realm.savedCompletion` + `savedEffects` generator swapping) to remember the abrupt half of a `JoinedNormalAndAbruptCompletions`.
   Every evaluator that introduces a control-flow boundary (`LabeledStatement`, `SwitchStatement`, `TryStatement`, `ForStatement`, `WhileStatement`, `DoWhileStatement`, `call.js`) has to manually coordinate all three mechanisms. Forgetting to clear `savedCompletion` on entry leaks outer throws inward; forgetting to incorporate it on exit silently drops inner `break`/`return`/`throw`.
2. **Dual data structure (`consequent`/`alternate` binary tree + `composedWith` linked list):**
   Sequential `if (...) return` statements chain onto `JoinedNormalAndAbruptCompletions.composedWith`, while `if/else` nests into `consequent`/`alternate`. Every helper on `Completion` must walk both structures, and several disagreed:
   - `makeSelectedCompletionsInfeasibleInCopy` ignored `composedWith` while `makeSelectedCompletionsInfeasible` walked it.
   - `joinValuesOfSelectedCompletions` dropped `keepInfeasiblePaths` on recursive calls.
   - `createJoinConditionForSelectedCompletions` conjoined `jcw && jc` on `composedWith`, which is only sound when `selector` selects *normal* completions (`jcw` = "reached the second split") and produces the wrong condition (`a && b` instead of `a || (!a && b)`) for abrupt selectors on unflattened chains.
3. **`JoinedNormalAndAbruptCompletions.value` is a footgun:**
   Inheriting `value: Value` from `Completion` forced the constructor to pick `consequent.value` when both arms contain normal sub-paths, silently discarding `alternate`'s normal values whenever a caller forgot to call `joinValuesOfSelectedCompletions`.

### Recommendation

1. **Short term (Phases 1–3 of this revival): keep the patched representation.**
   `completions.js` sits in a 56-file import cycle touching 25+ evaluators, `realm.js`, `widen.js`, and `serializer/`. Our targeted fixes (~350 net LOC) eliminated every `WRONG` case in `P3-joins` and every P3 fuzzer bug without breaking the 3,378-test serializer suite or colliding with parallel Phase 1 tracks. Rewriting completions right now would create massive merge conflicts in `realm.js` and `ForStatement`/`WhileStatement` for little immediate gain on acyclic code.
2. **Medium term (if Prepack continues to Phase 4 / general loop control flow): replace the 10 classes + `realm.savedCompletion` with a single flat `ExitPartition` (or HIR basic blocks).**
   Even without lowering JS to full SSA/HIR (as React Compiler later chose to do), within the AST evaluator the 10 classes, host-exception throwing of `AbruptCompletion`, `realm.savedCompletion`, and `composedWith` can all be replaced by one value returned uniformly from statement evaluation:
   ```js
   type ExitKey =
     | "normal"
     | "return"
     | "throw"
     | { kind: "break", label: ?string }
     | { kind: "continue", label: ?string };

   type ExitBranch = {
     guard: PathCondition,
     value: Value,
     effects: Effects,
   };

   // Map from ExitKey to at most one joined ExitBranch (invariants: guards are mutually exclusive).
   type StatementResult = Map<ExitKey, ExitBranch>;
   ```
   Why this strictly dominates the 10-class tree:
   - **No ambient `realm.savedCompletion`:** sequential statement composition `seq(R, nextStmt)` simply evaluates `nextStmt` only if `R.has("normal")` (under `R.get("normal").guard` and `R.get("normal").effects`), then merges each resulting exit key `k` with `R.get(k)` via `joinEffects`. If `!R.has("normal")`, `nextStmt` is dead code automatically.
   - **Every join point is a 3-line map operation:**
     - `LabeledStatement(L)`: pop `{ kind: "break", label: L }` and `joinEffects` it into `"normal"`.
     - `Switch` / loop exit: pop `{ kind: "break", label: null }` and `joinEffects` it into `"normal"`.
     - `TryStatement`: pop `"throw"`, evaluate `catch` under its `guard` and `effects`, and merge the handler's `StatementResult` with the remaining map.
     - Function boundary: pop `"return"` and `"normal"` into the return value/effects, leaving only `"throw"` for the caller.
   - **Bounded size (`O(|labels|)` instead of `O(branches)` trees):** similar exits collapse eagerly at every join instead of building deep binary trees of `JoinedNormalAndAbruptCompletions` + `composedWith` spines, which also makes fixed-point widening of loops containing `break`/`return`/`throw` (`PP0035`/`PP0037`) straightforward.
