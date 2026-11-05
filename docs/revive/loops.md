# Track 1E-i: Loops with Unknown Trip Counts (Problem P1)

## Overview

Upstream Prepack could only unroll `for`, `while`, `for-in`, and `for-of` loops (failing at the first abstract condition or after 6 iterations via `PP0035`), or in pure scope (`__optimize`) wrap a failed `for`/`while` in a zero-argument closure (`FOR_STATEMENT_FUNC`) that:
1. Emitted a spurious empty-message `FatalError PP0001` before recovering (`#2396`);
2. Failed with `PP0037` whenever the loop body used `return`, `throw`, `arguments`, labeled `break`/`continue`, or destructuring `var` declarations; and
3. Never checked whether the loop modified untracked outer or global state, silently dropping those mutations.

Meanwhile, `DoWhileStatement` was the only evaluator wired to `realm.evaluateForFixpointEffects` / `Widen`, which contained two silent miscompilation bugs (`#1722` and `do-while-build-object`).

On the 21-test `P1-loops` corpus, baseline Prepack scored **0 PASS, 19 CRASH, 2 WRONG, 0 BLOAT**. After this track, it scores **20 PASS, 0 CRASH, 0 WRONG, 1 BLOAT** (and **+24 PASS, -2 WRONG, 0 regressions** across the 133-test hard corpus).

---

## Root Causes of Baseline Bugs

### 1. Silent miscompiles (`WRONG`) in `DoWhileStatement` / `Widen`
- **Pre-loop properties dropped (`#1722`)**: In `PropertiesImplementation.OrdinarySetPartial` (`src/methods/properties.js`), writing to an object with a widened numeric index (`pIsLoopVar && pIsNumeric`) executed `O.properties.delete(key)` on *every* numeric property of `O`, including concrete numeric properties (`{ 0: "a", 1: "b" }`) established before the loop.
- **Shifted keys on global `var` counters (`#1722`)**: Widening a property on `$GlobalObject` (`var i = 2`) created an atemporal `WIDEN_PROPERTY` expression (`_J.i`). During code generation (`effects2`), `i++` on the intrinsic `$GlobalObject` emitted an inline `GLOBAL_ASSIGNMENT` (`_$2.i = 1 + _J.i`) *before* `realm._emitPropertyAssignments` emitted deferred heap writes (`_2["" + _J.i] = "x"`), causing `arr[i] = "x"` to use the post-increment `i` (`3, 4, 5` instead of `2, 3, 4`).
- **Post-loop writes lost (`do-while-build-object`)**: Running `evaluateForFixpointEffects` in pure scope left `unknownProperty` descriptors on objects that already had own properties, causing subsequent writes (`o.count = i`) after the loop to be lost or misordered during serialization.
- **Dirty rollback on failed fixpoint**: `Widen.widenBindings` and `Widen.widenPropertyBindings` appended `phiNode` / `WIDEN_PROPERTY_ASSIGNMENT` entries directly to the outer `realm.generator` and mutated `b.phiNode` / `pb.pathNode` before knowing whether the fixpoint would converge.

**Fix**:
- In pure scope, `DoWhileStatement` goes directly to `residualizeLoop`.
- In global code, `Widen.widenPropertyBindings` now aborts fixpoint widening (rolling back cleanly via `evaluateForEffects` + `Widen.beginFixpoint`/`endFixpoint`) whenever a property on `$GlobalObject` would be widened or whenever indexed/`unknownProperty` widening targets an object that already had own properties before the loop, falling back to `residualizeLoop`.

### 2. Empty-message `PP0001` (`#2396`)
`ForStatement` set `realm.suppressDiagnostics = true` during speculative unrolling. In `AbstractValue.reportIntrospectionError`, `suppressDiagnostics` replaced the message string with `""` *without* skipping `realm.handleError(diagnostic)`. External error handlers (`prepack-cli`, `hard-scoreboard.js`) ignored the second `suppressDiagnostics` parameter and recorded a fatal `PP0001: ""` even when the pure-scope loop bail-out succeeded.

**Fix**: `evaluateSpeculatively` in `src/evaluators/residualLoop.js` installs a temporary `realm.errorHandler` with `suppressDiagnostics = false` that captures the first diagnostic message internally without forwarding speculative failures to the user's error handler. If `residualizeLoop` later bails out, both the trial failure reason and the original unrolling failure reason are included in `PP0037`.

---

## Design of `src/evaluators/residualLoop.js`

All five loop evaluators (`ForStatement`, `WhileStatement` via `ForStatement`, `DoWhileStatement`, `ForInStatement` in pure scope, and `ForOfStatement` in pure scope) first attempt normal concrete unrolling inside `evaluateSpeculatively`. Only when unrolling fails does Prepack invoke `residualizeLoop`:

1. **Initializer pre-evaluation (`evaluateForInit`)**: For `ForStatement`, a `var` or expression `init` is speculatively evaluated once before the loop so bindings have their initial values and `init` is omitted from the residual loop header.
2. **AST normalization (`transformLoop`)**:
   - `var` declarations inside the loop (including destructuring `var` patterns and `for (var ... in/of ...)`) become assignments to the hoisted function/global bindings; `let`/`const` remain block-scoped inside the loop.
   - `return <expr>` becomes `return (__prepack_loop_value = <expr>, 1)`.
   - `break <label>` / `continue <label>` targeting labels outside the loop become `return <code>` (`2, 3, ...`).
   - After the wrapper call, an `if` chain on the returned exit code reconstructs the exact `ReturnCompletion`, `BreakCompletion`, or `ContinueCompletion` in Prepack's completion machinery (`throw` propagates naturally via `evaluateWithPossibleThrowCompletion`).
   - `arguments` references are rewritten to a formal parameter (`__prepack_args`) supplied with the enclosing function's runtime `arguments` at the call site.
3. **Read-only parameter passing (`collectReadOnlyParams`)**: Local bindings of the current optimized function that are read by the loop, never assigned in the loop, and not captured by inner closures are passed as formal parameters to the wrapper closure rather than leaked as mutable `__l` storage. (If an indirect helper call inside the loop modifies such a binding, `residualizeLoop` automatically retries with full leaking.)
4. **Leaking and materialization**:
   - In pure scope, `Leak.value` materializes all reachable objects created in the current pure scope at the exact temporal point before the wrapper call and havocs mutated local bindings (`__l0`, `__l1`, ...). `OrdinarySetPartial` was also updated to emit runtime property assignments on leaked objects in pure scope.
   - In global code (`for`, `while`, `do-while`), `leakForGlobalCode` leaks reachable objects and global `let`/`const` bindings (serialized at their temporal point rather than re-emitted at program end) and records assigned global `var` properties, which `havocGlobalProperties` turns into `OBJECT_GET_PARTIAL` reads on `$GlobalObject` during and after the loop.
5. **Single-iteration soundness gate (`makeTrialBody` + `checkTrialEffects`)**:
   - A cloned single-iteration AST (`makeTrialBody`) is evaluated with `evaluateForEffects` against the leaked/havoced state (marked `prepackTrialLoop` so it never recursively residualizes itself).
   - Because `SwitchStatement.js` caps abstract discriminants at `< 6` cases, `lowerTrialSwitches` rewrites `>= 6`-case switches *only in the discarded trial AST* into a labeled block with an index selector preserving ECMA-262 case evaluation order and fallthrough (`#2477`).
   - `checkTrialEffects` inspects all `Effects` (including `savedEffects` inside joined completions) and rejects the loop with `PP0037` if any modified binding is neither leaked nor trial-local, if any modified property belongs to an object neither created in the trial nor already leaked (nor an assigned global `var`), or—in global code—if the iteration may throw or emit an unsafe `CALL_BAILOUT`.

---

## Handled vs. Unsolved Loop Shapes

### Handled
- Counter, accumulator, multi-variable (`gcd`), and data-dependent (`collatz`) `for`/`while`/`do-while` loops.
- String scanning loops (`#2055`) in both `__optimize` and global code.
- Loops mutating known objects or arrays at abstract keys/indices while preserving pre-loop and post-loop properties (`#1174`, `#1722`, `do-while-build-object`).
- Babel-lowered `for-of` loops (`#2053`), including `>= 6`-case `switch` with fallthrough and early `return` (`#2477`).
- Native `for-in` and `for-of` over unknown objects/iterables in `__optimize`.
- `break`, `continue`, labeled `break`/`continue` across nested loops, `return`, `throw`, `this`, `arguments` (read-only), and object-destructuring `var` inside loops in `__optimize`.

### Not Handled (and Why)

1. **Loops in `__optimize` mutating outer closure or global state** (sound `PP0037` bail-out):
   ```js
   var count = 0;
   function f(n) {
     for (var i = 0; i < n; i++) count++;
   }
   __optimize(f);
   // PP0037: the loop may modify property count of global, which was not created by the optimized function or is not tracked
   ```
   Prepack's `__optimize` contract assumes pure functions only mutate objects allocated within the pure scope (or leaked arguments). Summarizing arbitrary global mutations across unknown call counts requires whole-program effect summaries.

2. **Global-code loops calling unknown functions or methods on untyped abstract values** (sound `PP0037` bail-out):
   ```js
   // e.g. real-world/config-parser-env-override.js
   var pairs = abstractStr.split(";");
   for (var i = 0; i < pairs.length; i++) {
     var kv = pairs[i].split("="); // pairs[i] has top type Value -> CALL_BAILOUT
   }
   ```
   In global code, an arbitrary unknown call could mutate any global variable or pre-existing object. Once Track 1D (built-in effect summaries) models `String.prototype.split` elements as `StringValue`, `pairs[i].split("=")` resolves directly to `String.prototype.split` without `CALL_BAILOUT` and this loop becomes handleable.

3. **Global-code loops that may throw or exit via outer labels** (sound `PP0037` bail-out):
   ```js
   do { i++; if (i > 5) throw "err"; } while (i < n);
   ```
   Global code has no enclosing pure-scope try/completion wrapper (`evaluateWithPossibleThrowCompletion` is pure-scope only).

4. **Iterable array-destructuring of abstract values inside a loop** (sound `PP0037` bail-out):
   ```js
   function f(pairs) {
     for (var i = 0; i < pairs.length; i++) {
       var [a, b] = pairs[i]; // trial hits GetIterator on abstract pairs[i]
     }
   }
   ```
   Prepack's `DestructuringAssignmentEvaluation` invokes `Symbol.iterator` concretely on `ArrayPattern` targets.

5. **Inlining bloat around a compact residual loop (`P1-loops/issue-1959-shallow-equal.js`)**:
   `issue-1959-shallow-equal.js` produces the **correct result** with no diagnostics, and the emitted residual loop itself is compact (~220B), but total output is 2.5x input (1889B vs 757B, limit 2.0x) because `is` and `shallowEqual` are global functions (kept in output) *and* Prepack inlines both into `foo` as ~45 un-inlined SSA `var` declarations before the loop. Addressing this belongs to Track 2C (inlining cost model / expression inlining).

6. **Relational post-loop invariants on leaked objects**:
   ```js
   function f(n) {
     var o = { tag: "keep" };
     for (var i = 0; i < n; i++) o["k" + i] = i;
     return o.tag; // emitted as residual `_o.tag` rather than constant-folded `"keep"`
   }
   ```
   Because `o` is leaked before the residual loop, post-loop reads from `o` are emitted residually (`_o.tag`) — always **correct**, but losing the constant fact `o.tag === "keep"` because `"k" + i !== "tag"` is not proved. Proving disjoint key invariants is Track 2A's target.
