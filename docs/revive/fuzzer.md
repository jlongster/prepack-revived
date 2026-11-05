# Track 0C: Differential Fuzzer (`fuzzer/`)

## What changed and why

Prepack's original fuzzer (`fuzzer/`, Caleb Meredith, PR #2374) generated pure scalar/conditional/function programs via `testcheck` and stored results in `sqlite3` (whose native addon no longer builds cleanly on Node 26). It also had several practical limitations for Phase 1–3 revival work:

1. **Hard-coded Prepack target & options**: `execute.js` required `../../lib/prepack-node.js` directly with `invariantLevel: 3`, React flags, and an error handler that conflated clean `FatalError` bailouts with miscompiles and crashes.
2. **Non-reproducible seeds in `sampleOne`**: `testcheck`'s `sampleOne` pulls from a load-time PRNG seeded from `new Date().valueOf()`, making individual programs non-reproducible by seed, while linear sizing blew up nested helper counts to hundreds of KB.
3. **Single-process shrinking without hard timeouts**: Prepack hangs or stack-overflows on some loops/path explosions; shrinking in-process meant a single hang killed the run.
4. **Narrow language coverage**: the classic generator only emitted literals, `var`, `? :`, `if/else`, `return`, and non-recursive helper functions, missing loops, `switch`, `try/catch/finally`, `throw`, labels, objects/arrays, closures, unknown callbacks, strings, and mixed-type operations.

### Revived architecture

- **Dependencies (`fuzzer/package.json`)**: removed native `sqlite3` (plus unused `chalk`/`pretty-ms`), upgraded `@babel/generator` and `@babel/types` to `^7.29.0`, and added `@babel/parser` and `@babel/traverse` for AST-based reduction. `cd fuzzer && yarn install --ignore-engines` installs in <1s on Node 26.
- **Shared corpus-compatible program shape (`fuzzer/src/program.js`)**: both `classic` and `extended` emit an IIFE defining `main`, guarding `if (global.__optimize) __optimize(main); global.main = main;`, and defining a deterministic `inspect()` that calls `main` across multiple mixed-type argument tuples (catching thrown values and formatting `-0`, `NaN`, arrays, objects, functions, and `Error` instances without depending on V8 error message wording).
- **Modes (`fuzzer/src/classic.js`, `fuzzer/src/extended.js`)**:
  - `--mode classic`: preserves Caleb Meredith's original `testcheck` generator (`fuzzer/src/gen.js`), pinning `testcheck` via `check(..., { numTests: 1, seed })` with quadratic size biasing so every `(classic, seed)` pair deterministically reproduces the same program.
  - `--mode extended` (default): a seeded (`mulberry32`) generator covering `for` / count-down `for` / `while` / `do-while` / `for-in` loops with abstract bounds and tamper-proof fuel counters, `break` / `continue` (including labeled jumps), labeled blocks, `switch` with fall-through and `default`, `try` / `catch` / `finally` and conditional `throw`, object literals + static/computed reads/writes/`delete`/`in`, array literals + `push`/`pop`/index writes/`join`/`indexOf`/`length`, closures capturing and mutating outer bindings, unknown function arguments (`fns`), string operations, and `typeof`/truthiness/coercions on mixed types (`0`, `-0`, `NaN`, `Infinity`, strings, booleans, `null`, `undefined`, arrays, objects).
  - `--disable <features>`: lets Phase 1 tracks mask known noisy bug sources (e.g. `--disable update` or `--disable loops,forin,update`) while hunting deeper bugs in their target subsystem.
- **Oracle & classifier (`fuzzer/src/run.js`)**: executes plain Node (`vm.Script`, 4s timeout) and `prepackSources`, classifying each program into:
  - `wrong`: Prepack reported no errors, but residual `inspect()` differs from plain Node (or throws on load).
  - `wrong-recovered`: Prepack reported an error diagnostic (under `--recover` or pure-scope bailout) yet still emitted wrong residual code.
  - `invariant`: Prepack threw `InvariantError` / `Invariant Violation`.
  - `crash`: Prepack threw another unhandled internal exception (e.g. `InfeasiblePathError`).
  - `fatal`: clean Prepack bailout (`FatalError` / `CompilerDiagnostic`) — counted by `PPxxxx` code, **not** treated as a failure by default.
  - `timeout` / `died` / `invalid`: per-task wall-clock timeout, worker crash, or generator bug (`invalid` stayed at **0** across >48,000 generated programs).
- **Worker pool & AST reducer (`fuzzer/src/pool.js`, `fuzzer/src/minimize.js`, `fuzzer/src/fuzz.js`)**: runs generation and parallel batch AST reduction across child processes with hard `SIGKILL` timeouts and worker recycling. Reduction preserves the `inspect()` harness (`fmt`, `fns`, `try/catch`) while shrinking `args` tuples, statements, branches, and expressions in two phases (coarse statement-level fixpoint first, then expression-level).

---

## How to run

From the repo/worktree root:

```sh
yarn build-prepack
yarn fuzz --time 300 --seed 1 --mode extended
yarn fuzz --time 300 --seed 1 --mode classic
yarn fuzz-sample --mode extended --seed 7 --count 2 --run
yarn fuzz-minimize path/to/failure.js
```

From any other agent's worktree (no changes needed in that worktree):

```sh
node /tmp/opencode/pp-wt/fuzz/fuzzer/src/fuzz.js \
  --prepack /path/to/your-worktree \
  --time 300 \
  --seed 1 \
  --mode extended
```

Useful flags: `--jobs <n>`, `--disable update,loops,...`, `--recover`, `--invariant-level <0..3>`, `--minimize <sec>`, `--out <dir>`. Outputs go to `<out>/raw/`, `<out>/min/`, and `<out>/summary.json`.

---

## Fuzzing campaign summary (`0.2.55-alpha.0`, branch `fuzz`)

Across our campaigns (~58 CPU-minutes of generation + parallel AST minimization on Node v26.7.0):

| Campaign | Mode & flags | Seed | Wall gen time | Programs | `pass` | `fatal` (clean bailout) | `wrong` | `wrong-recovered` | `invariant` | `crash` | `timeout` | `invalid` |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | `classic` | 100000 | 1514 s | 4,047 | 3,949 | 0 | 18 | 0 | 0 | 1 | 79 | **0** |
| 2 | `extended` | 200000 | 1500 s | 38,206 | 12,076 | 23,857 | 1,209 | 643 | 407 | 0 | 14 | **0** |
| 3 | `extended --disable update` | 500000 | 210 s | 6,645 | 2,131 | 4,325 | 33 | 94 | 62 | 0 | 0 | **0** |
| **Total** | | | **3,224 s** | **48,898** | **18,156** | **28,182** | **1,260** | **737** | **469** | **1** | **93** | **0** |

*(Note: `wrong-recovered` entries above occurred when Prepack recorded a `PP0001`/`PP0008` diagnostic inside a pure/recovered scope during nested evaluation yet returned serialized code without throwing `FatalError`, or when `--recover` was active.)*

Clean `fatal` error code breakdown in Campaign 2 (`extended`, 23,857 fatals):
- `PP0001` (unsupported abstract op / loop bailout): 17,640
- `PP0021` (possible throw inside `try`/`catch`): 3,922
- `PP0008` (possible symbol / unknown `valueOf`/`toString` coercion): 1,697
- `PP1002` (unknown property write on intrinsic/global): 587
- `PP0035` (abrupt completion in loop): 6
- `PP0042` (unsupported dynamic property delete): 5

---

## Distinct bugs found and added to `test/serializer/hard/fuzz/` (25 tests)

Every distinct bug below was minimized, cleaned of dead/non-terminating artifacts, verified deterministic in plain Node (`node scripts/hard-scoreboard.js --filter fuzz/ --check-plain`: 25/25 clean), and committed under `test/serializer/hard/fuzz/`.

*(Note: classic mode also re-discovered known corpus issues `#2355` (`if (a) return true; else return false;` -> `return a`) and `P3-joins/labeled-block-break.js`; those were already in `P4-paths/` and `P3-joins/` so they were not duplicated.)*

### A. Silent miscompiles (`WRONG` — 9 tests, plus 1 `wrong-recovered` test)

| Test (`test/serializer/hard/fuzz/...`) | Tag | Mode | Probable `src/` area | Minimal failure mechanism |
|---|---|---|---|---|
| `call-after-nested-returns.js` | P3 | classic | `methods/call.js`, `methods/join.js`, `completions.js` | `if (a) { if (b) { if (c) return 0; } else return undefined; } else return 0; noop();` — calling `noop()` on the remaining normal path (`a && b && !c`) drops the `a && !b` return arm, returning `0` instead of `undefined` for `main(true, false, false)`. |
| `conditional-inner-throw-outer-alternate.js` | P3 | classic | `evaluators/ConditionalExpression.js`, `realm.js` (`evaluateWithAbstractConditional`), `methods/join.js` | `return x ? (y ? 0 : boom()) : "outer";` — joining `PossiblyNormalCompletion(0, Throw)` from the consequent with `"outer"` drops `"outer"` completely, returning `0` when `x` is falsy. |
| `throw-before-try-catch-finally.js` | P3 | extended | `evaluators/TryStatement.js`, `completions.js` | `if (a) throw new Error("before"); try {} catch (e) { return "caught"; } finally { ... }` — an exception thrown under an abstract condition *before* `try` is caught by `catch` and triggers `finally` (including swallowing the throw if `finally` returns). |
| `do-while-false-abrupt.js` | P3 | extended | `realm.js` (`evaluateWithUndoForDiagnostic`), `evaluators/DoWhileStatement.js` | `do { if (a) throw/return ...; } while (false)` (and `do {} while (a && boom())`) — `evaluateWithUndoForDiagnostic` checks `resultVal instanceof AbruptCompletion` and returns `resultVal.value` instead of `returnOrThrowCompletion(resultVal)`, silently dropping `JoinedNormalAndAbruptCompletions`. |
| `labeled-break-skips-code-after-block.js` | P3 | extended | `evaluators/LabeledStatement.js`, `completions.js` | `B: { if (a) break B; } return fn(a);` — `LabeledStatement` fails to absorb `BreakCompletion("B")` inside a `PossiblyNormalCompletion`, so `fn(a)` after `B:` is guarded by `if (!a)` and `main(true, fn)` returns `undefined` without calling `fn`. |
| `do-while-object-hoisted-param.js` | P1 | extended | `evaluators/DoWhileStatement.js`, `methods/widen.js`, `serializer/ResidualHeapSerializer.js` | `function main(a, step) { do { var k = step(); var o = { p0: a }; } while (k); return o.p0; }` — Prepack hoists `var _6 = { p0: a };` to module top-level scope outside `main`, throwing `ReferenceError: a is not defined` when loading the bundle. |
| `update-expression-string.js` | P4 | extended | `evaluators/UpdateExpression.js` | `function main(a) { a++; return a; }` — Prepack emits `a + 1` without `ToNumeric`/`ToNumber`, returning `"01"` and `"a1"` on string inputs instead of `1` and `NaN`. |
| `conditional-null-check-negation.js` | P4 | extended | `utils/simplifier.js`, `utils/paths.js` | `!(a == null ? 0 : a)` is simplified to `a == null`, returning `false` instead of `true` for falsy non-nullish values (`0`, `""`, `false`, `NaN`). |
| `unused-property-read-throws.js` | P6 | extended | `methods/get.js`, `evaluators/MemberExpression.js`, `serializer/ResidualHeapVisitor.js` | `function main(a) { var unused = a.p; return 1; }` — unused property get on an unknown value is dead-code-eliminated even when `a` is `null`/`undefined` (must throw `TypeError`) or has a throwing/side-effecting getter. |
| `throw-in-call-argument-join.js` *(CRASH w/ wrong recovered code)* | P3 | extended | `methods/join.js`, `methods/call.js` | `var x = a1 ? Math.min(h(a1), a1) : 0; h(x);` where `h(p)` throws on `p >= 0` — reports `PP0001` and in recovered code loses the `: 0` branch so `main(undefined)` fails to throw. |

### B. Unhandled crashes & invariant violations (`CRASH` — 15 tests)

| Test (`test/serializer/hard/fuzz/...`) | Tag | Mode | Crash / invariant site | Minimal failure mechanism |
|---|---|---|---|---|
| `infeasible-path-explored-crash.js` | P4 | classic | `realm.js` (`evaluateWithAbstractConditional`) | Uncaught `InfeasiblePathError` (`Error: Infeasible path explored`) escapes top-level `IfStatement` when both `withCondition(x)` and `withInverseCondition(x)` throw `InfeasiblePathError` after prior nested conditional returns on `x`. |
| `path-implies-both-true-visitor.js` | P4 | extended | `serializer/ResidualHeapVisitor.js` (`_visitAbstractValueConditional`) | `if (!a) { o.p = 0; if (a == null) throw ...; f(o); }` — under feasible path `!a && a != null` (`0`, `""`, `false`, `NaN`), `Path.implies` and `Path.impliesNot` both return `true`, tripping `invariant(!(impliesT && impliesF))`. |
| `loop-null-check-path-condition.js` | P4 | extended | `utils/paths.js` (`pushPathCondition`) | `do/while` with `x == null`, `typeof x`, and `y !== undefined` checks on joined bindings trips `invariant(false, "assuming that false equals true is asking for trouble")`. |
| `widen-nested-loop-in-helper.js` | P1 | extended | `methods/widen.js` (`widen`) | `for` loop nested in `do/while` inside a conditionally called helper trips `invariant` in `widen()`. |
| `do-while-break-abrupt-widen.js` | P1 | extended | `methods/widen.js` (`widenResults`) | `do/while` whose body may throw (`a.slice(0)`) or `break` trips `invariant(..., "if a loop iteration ends abruptly, there is no need for fixed point computation")`. |
| `do-while-object-emitter.js` | P1 | extended | `serializer/Emitter.js` (`finalize`) | Object literal `{ p0: a.slice(0) }` inside an abstract `do/while` leaves unresolved emitter dependencies in `Emitter.finalize()`. |
| `do-while-emitter-active-generator.js` | P1 | extended | `serializer/Emitter.js` (`_emitAfterWaitingForGeneratorBody`) | Unreturned object written inside `do { o[0] = a3; } while (a1 * 0 && ++i < 2)` followed by throwing `o.p2 = a3.charAt(0)` trips `invariant(this._activeGeneratorStack.includes(reason))`. |
| `conditional-push-while-join-mismatch.js` | P1 | extended | `serializer/ResidualHeapSerializer.js` (`serialize`) | `if (a1) { r.push(0); while (r[0] && ...) {} } else { o = { p0: r.join(",") }; }` causes visitor/serializer set mismatch (`Invariant Violation: serialized 21 of 23`). |
| `labeled-break-before-throw-call.js` | P3 | extended | `methods/call.js` (`processResult`) | `B: { if (a) break B; throw e1; } throw e2;` leaves a completion with `BreakCompletion` + `ThrowCompletion` and no `NormalCompletion`, tripping `invariant` in `processResult`. |
| `switch-empty-nan-discriminant.js` | P3 | extended | `methods/join.js` (`mapAndJoin` via `SwitchStatement.js`) | `switch (a1 ? NaN : 0) {}` trips `invariant` in `Join.mapAndJoin`. |
| `switch-hoisted-var-loop.js` | P3 | extended | `serializer/ResidualHeapSerializer.js` (`serializeBinding`) | `switch (0) { case 0: { var i; } default: for (; b && i; ) {} } return [i];` trips `invariant` in `serializeBinding`. |
| `switch-nested-abrupt-default.js` | P3 | extended | `evaluators/SwitchStatement.js` (`DefiniteCaseEvaluation`) | Switch with fall-through calling helper whose `default:` contains an abrupt nested `switch (boom()) {}` produces a `JoinedNormalAndAbruptCompletions` in `DefiniteCaseEvaluation`, tripping `invariant(result instanceof Value)`. |
| `delete-abstract-coercible-base.js` | P6 | extended | `evaluators/UnaryExpression.js` (`evaluateDeleteOperation`) | `if (a != null) delete a.p;` passes `CheckObjectCoercible` with a generic `AbstractValue` (e.g. primitive or object) and trips `invariant(base instanceof ConcreteValue \|\| base instanceof AbstractObjectValue)`. |
| `unknown-property-concrete-get.js` | P6 | extended | `methods/get.js` (`OrdinaryGet`) | `var o = { a: 1 }; o[k] = undefined; return [o.a, o.x];` stores concrete `UndefinedValue` in `o.unknownProperty.descriptor.value`, tripping `invariant(val instanceof AbstractValue)` in `OrdinaryGet`. |
| `unknown-property-concrete-get-partial.js` | P6 | extended | `methods/get.js` (`OrdinaryGetPartial`) | Same root cause on dynamic read `o[k2]`, tripping `invariant(val instanceof AbstractValue)` at `OrdinaryGetPartial`. |

---

## Remaining limitations and recommendations for Phase 1–3

1. **Bug masking during unrestricted fuzzing**: very frequent bugs (`a++` on strings, `!(a == null ? 0 : a)`, `labeled-block-break`) account for >90% of raw `wrong` hits in unrestricted `extended` mode and can also act as "attractors" during expression-level AST reduction (where replacing subexpressions with literals happens to manufacture `a ? true : false`). Use `--disable update` (or `--disable update,labels`) until P4/P3 land fixes for those bugs.
2. **Fuel-guard deletion in minimized loops**: `minimize.js` only requires that the reduced program terminate on the concrete `args` tuples in `inspect()`. It may therefore strip `++i < fuel` from a loop that happens to run 0–1 times on the surviving `args`. Always add a fuel bound or verify general termination before promoting reduced loop tests to the corpus.
3. **Top-level / constructor / recursion / prototype coverage**: both `classic` and `extended` currently focus on `__optimize(main)` over ES5 control flow, closures, objects, and arrays. Extending generation to `new C(...)` constructors (as in `#2561`), `Object.defineProperty` getters/setters, global-init code without `__optimize`, and bounded mutual recursion would exercise P2 and P6/P7 surfaces once Phase 1 lands initial fixes.
