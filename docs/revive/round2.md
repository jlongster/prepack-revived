# Track R2: correctness round 2

Goal: remove the remaining WRONG and invariant failures from the hard corpus and from fuzzing, without trading
correctness for coverage. Every fix comes with a minimized regression in `test/serializer/hard/fuzz/` (44 cases;
the ones added in this round all reproduce as WRONG or CRASH on `revive` @ 7419257e).

## Method

1. Fix the corpus targets, then fuzz the branch (`fuzzer/src/fuzz.js`, extended and classic modes, with `--recover`),
   minimize every WRONG/invariant/crash (`--minimize`), find the root cause, fix it, and add the minimized program
   as a corpus case.
2. Re-run fuzzing under the Z3 audit (`PREPACK_SMT=audit PREPACK_SMT_AUDIT_THROW=1`) so that every simplifier
   rewrite and every hand-written implication is checked against the solver.
3. Merge `revive` periodically (size, bench2, env, smt) and re-fuzz after each merge.

## What changed, by area

### Joins and completions (`completions.js`, `methods/join.js`, `realm.js`, `evaluators/*Loop*`)
- A conditional call whose base may be null/undefined throws the `TypeError` on that branch instead of joining it
  away; call joins where one side only throws keep the throw.
- `composedWith` chains: each saved completion layer is composed separately, so effects are no longer joined twice.
- `for`/`for-in`/`for-of`/`do-while` bodies run inside `evaluateCompletionInSavedCompletionScope`, which normalizes
  `continue`/`break` joins; iterator internal slots hold `Value`s so they join correctly.
- `composeWithSavedCompletion` handles infeasible paths; `evaluateForEffects` restores path conditions when the
  evaluation fails.

### Simplifier, path conditions and SMT (`utils/simplifier.js`, `utils/paths.js`, `utils/smt/*`)
- Removed or restricted rewrites the Z3 audit proved unsound (logical/comparison rewrites, `x != null` treated as
  truthiness, depth-truncated implication caching, hoisting nested temporals across conditional branches).
- `refineBaseConditons` detaches a node's base conditions while refining them; it now also clears (and restores) the
  implication caches of every node between the refinement target and that node, which otherwise answered from
  facts that depend on the detached conditions.
- The SMT translator value-numbers pure operations by descriptor; abstract arguments (`abstractCounted:*`) are now
  excluded, because the recursion probe creates several distinct arguments with the same name.
- Temporal `BINARY_EXPRESSION`/`UNARY_EXPRESSION` entries are translated as compound terms; `*`, `/`, `%` propagate
  `NaN` and handle boolean operands.

### Leaked (havoced) objects and pure scope (`utils/leak.js`, `methods/properties.js`, `evaluators/*`)
- `in` / `hasOwnProperty` on leaked or partially-unknown objects bail out (introspection error) instead of folding
  to `true`; `Object.keys/values/entries` on leaked objects return temporal arrays.
- Potentially throwing property reads, unary and binary operations are kept in pure scope.
- Objects mutated inside an inner `try` and leaked loop parameters are tracked correctly.

### Serializer (`serializer/*`, `utils/generator.js`)
- **Property order after unknown-key writes.** `o[k] = v; o.p = 1` used to serialize `p` before the computed write,
  changing `Object.keys` order. Property bindings now remember the unknown-property value at creation
  (`PropertyBinding.createdAfterUnknownWrite`, set in `InternalSetProperty`), and both the serializer and
  `materializeObject` emit such properties right after the matching computed write. Array indices are exempt.
- **Merging adjacent joins.** `Generator._appendEntry` merged two `JOIN_GENERATORS` with equal path conditions even
  when the second used a value declared inside the first (through a conditional such as `c ? _$0 : 0`); the
  serializer then had to declare that value before the `if` that defines `_$0`. Joins are merged only when the
  earlier one declares nothing.
- **Leaked bindings across passes.** `cleanInstance` reset `leakedIds` between serializer passes, so a leaked
  binding referentialized in pass 1 could lose its `var __lN` declaration. The ids are kept (deduplicated by name).
- Switch fallthrough into `default`, nested temporal promotion, leaked `ArrayValue` serialization, and the emitter's
  finished-body delay were fixed earlier in the round.

### Other
- `UpdateExpression` applies `ToNumber`; the recursion pure-call probe accepts `null`/`undefined` arguments.
- Conditionally empty unknown-property values are promoted to `undefined` (`promoteEmptyToUndefined` recurses into
  conditionals before giving up on a top value domain).
- Fuzzer: the minimizer rejects reductions whose oracle starts throwing a `ReferenceError` the original did not
  (deleting a declaration makes a read undeclared, and the open-world default assumes undeclared globals exist, so
  the reduction would drift to an unrelated mismatch).

## Unsolved, and why

- **Property order with unknown-key writes inside branches.** The creation marker lives on the property binding,
  not in the effects, so `if (c) { o[k] = 1; o.x = 1 } else { o.x = 2 }` still serializes `x` before the computed
  write. A complete fix needs the marker joined with the effects (or a conditional emission order). Multiple unknown
  writes in a straight line are handled.
- **Reads of undeclared globals.** Under the open-world default (`unknownGlobals: "open"`), `undeclared;` is
  assumed to succeed and its unused read is dropped, so a program that relies on the `ReferenceError` changes
  behavior. This is the environment track's design, not a join/serializer bug; `--unknownGlobals closed` restores
  the `ReferenceError`.
- **Audit gap for loose equality with leaked objects.** The simplifier folds `obj == x` using Prepack's model of
  `obj`; the audit treats objects as opaque (any `ToPrimitive`), so it reports a counterexample when the object has
  leaked. In the fuzz case nothing actually changes the object's `valueOf`, so the output is right, but a leaked
  object whose `valueOf` really is changed by unknown code would be mis-folded.
- **P9 async/promise at init** (`async-function-defined-at-init`, `promise-then-at-init`) stay WRONG, as on
  `revive`: job queues at global init are outside this track.
- `fuzz/labeled-break-before-throw-call.js` remains a clean `PP1002` bail-out (correct recovered output).
