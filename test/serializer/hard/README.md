# Hard-case corpus

These are the tests that later phases of the Prepack revival are measured against (see `/tmp/opencode/pp-hard/PLAN.md`). Each test captures one of the problems that made the original team stop. A test describes what a **fixed** Prepack should do, so most of them fail today.

## Taxonomy

| Folder | Problem | Typical sources |
|---|---|---|
| `P1-loops/` | Loops with unknown trip counts (residual loops, widening, state before the loop, `return`/`break`/`throw` in loops) | #1174, #1722, #2396, #2055, #1959, #2053, #2477, PP0035/PP0037 |
| `P2-recursion/` | Recursion under unknown conditions (summarization, no unrolling to stack depth) | #543, #1586 |
| `P3-joins/` | Joins of return/throw/break under abstract conditions, `switch`, try/catch/finally | #2354, #2363, #2561, #2120, #1378, #1869, PP0021 |
| `P4-paths/` | Path conditions and the simplifier (implication, truthiness, null/undefined) | #2355, #2361, #2563, #2564, #2327 |
| `P5-ranges/` | Numeric facts, e.g. `length` after a conditional `push` | #1066 |
| `P6-havoc/` | Objects leaking to unknown code, aliasing, built-ins with abstract args, lazy caches | #2319, #2179, #2011, #2012, #1750, #2226, #977, #705, #1682 |
| `P7-environment/` | DOM, window, timers, Node globals, `Date`, time zones, `Intl` | #24, #624, #1003 |
| `P8-size/` | Output larger than input (unrolling, literal tables, inlining explosion, duplicate code) | #2140, #2142, #2220, #2286, #2011 |
| `real-world/` | Realistic init code: lodash-style setup, config parsers, lookup tables, a module system, template compilers, Babel class helpers, a router, i18n, React-like rendering | new |

## Test format

Each test uses the format of `scripts/test-runner.js`: a script that defines a global `inspect()` returning a string. Unknown inputs are written as `global.__abstract ? __abstract("number", "(5)") : 5`, and functions are specialized with `__optimize(fn)`. Every test is a correct, deterministic program in plain Node; `node scripts/hard-scoreboard.js --check-plain` verifies this.

Each test starts with a header:

```js
// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/1174   (or "variant of #1174", or "new")
// goal: emit a residual for-loop for an unknown trip count; no FatalError; output <= 2x input
```

Optimized-function tests call the function on several inputs from `inspect()`, so a wrong join shows up on at least one path.

The scoreboard understands these markers:

| Marker | Meaning |
|---|---|
| `// does contain:X` / `// does not contain:X` | Goal check on the output, same meaning as in the test runner. A failure counts as BLOAT. |
| `// add at runtime:CODE` | One line of code that runs before both the original and the Prepacked code, but that Prepack never sees. Used for environment objects such as `document` and `require`. |
| `// max size ratio: N` | Size limit, default 2. Sizes are compared after minifying both sides with Babel. |
| `// runtime env: K=V ...` | Runs the original and the residual code in a subprocess with these environment variables, e.g. `TZ=Asia/Kolkata`. Prepack itself always runs with `TZ=UTC LANG=C`, so build time and run time differ, as they do in production. |
| `// prepack options: {json}` | Extra `prepackSources` options. |

## Classification

`scripts/hard-scoreboard.js` uses the same success rule as the CLI: a run succeeds only if it reports no FatalError and no RecoverableError. Each test gets one status:

- **PASS**: the run succeeds, the residual `inspect()` matches the original, the output is at most N times the input size (default 2x), and every marker holds.
- **CRASH**: there was a FatalError or RecoverableError diagnostic, an invariant failure or other exception, or a timeout (30s per test). Prepack sometimes recovers from a fatal error in pure scope and still emits code. The scoreboard runs that code anyway and records `[recovered output correct|wrong]`.
- **WRONG**: the run succeeds, but the output computes something different. This includes residual code that throws when the original doesn't (`residualThrows: true` in the JSON). These are silent miscompiles, the most important class.
- **BLOAT**: the output is correct but too large, or a goal marker failed.

## Running it

```sh
node scripts/hard-scoreboard.js                       # uses lib/prepack-node.js if built, else the published 0.2.54 in /tmp/opencode/pp-lab
node scripts/hard-scoreboard.js --prepack /tmp/opencode/pp-lab/node_modules/prepack
node scripts/hard-scoreboard.js --filter P3-joins     # substring of the path under test/serializer/hard
node scripts/hard-scoreboard.js --verbose --jobs 8 --timeout 60000
node scripts/hard-scoreboard.js --check-plain         # check that every test runs deterministically in plain Node
```

It needs no build step. Each test runs in a forked worker that is killed on timeout, so endless loops in Prepack are contained. A full run takes about a minute. Results go to `test/serializer/hard/results.json`: per test, the status, detail, error codes, sizes and ratio, the expected and actual output, and the residual code for WRONG cases. If you pass `--filter`, the file is only written when you also pass `--json <path>`.

### Relation to `yarn test-serializer`

`scripts/test-runner.js` also scans `test/serializer/**`. Commit `fd9a8a10` (from 0A) makes it skip `test/serializer/hard/` unless `--filter` contains `hard`, so expected failures here never show up as regressions in `yarn test-serializer`. To run a hard test through the official runner, which also checks fixed points, lint and option permutations, use `yarn test-serializer --filter hard/P3-joins/issue-2354`. Use a folder or file filter: a bare `--filter hard` would also pick up this README and `results.json`. Once a fix makes a test pass, it can be copied into the regular suite.

## Baseline (measured 2026-11-05, Node v26.7.0, 133 tests)

Published **prepack 0.2.54** (`/tmp/opencode/pp-lab`):

| folder | tests | PASS | CRASH | WRONG | BLOAT |
|---|---:|---:|---:|---:|---:|
| P1-loops | 21 | 0 | 19 | 2 | 0 |
| P2-recursion | 13 | 2 | 11 | 0 | 0 |
| P3-joins | 21 | 9 | 7 | 4 | 1 |
| P4-paths | 14 | 7 | 3 | 1 | 3 |
| P5-ranges | 9 | 1 | 7 | 0 | 1 |
| P6-havoc | 19 | 9 | 6 | 2 | 2 |
| P7-environment | 15 | 2 | 5 | 8 | 0 |
| P8-size | 9 | 1 | 1 | 0 | 7 |
| real-world | 12 | 7 | 4 | 0 | 1 |
| TOTAL | 133 | 38 | 63 | 17 | 15 |

Locally built **0.2.55-alpha.0** (`lib/prepack-node.js`, branch `revive`, after 0A's build fix):

| folder | tests | PASS | CRASH | WRONG | BLOAT |
|---|---:|---:|---:|---:|---:|
| P1-loops | 21 | 0 | 19 | 2 | 0 |
| P2-recursion | 13 | 2 | 11 | 0 | 0 |
| P3-joins | 21 | 9 | 7 | 3 | 2 |
| P4-paths | 14 | 7 | 3 | 1 | 3 |
| P5-ranges | 9 | 1 | 7 | 0 | 1 |
| P6-havoc | 19 | 9 | 6 | 2 | 2 |
| P7-environment | 15 | 2 | 5 | 8 | 0 |
| P8-size | 9 | 1 | 1 | 0 | 7 |
| real-world | 12 | 7 | 4 | 0 | 1 |
| TOTAL | 133 | 38 | 63 | 16 | 16 |

The only difference between the two: `P3-joins/return-in-nested-function-conditional-objects.js` is WRONG in 0.2.54, where the internal `__empty` sentinel leaks into a user-visible property value (`extra: {}`). It is BLOAT in 0.2.55.

On P1 through P6 the pass rate is 28/97 (29%). PLAN.md's target is at least 70% with zero WRONG.

### Silent miscompiles (WRONG) in the local build

| Test | What goes wrong |
|---|---|
| `P3-joins/labeled-block-break.js` | `break label` out of a block under an abstract condition is ignored: the function becomes `return "start-1-2"`. |
| `P1-loops/do-while-build-object.js` | Writes after a widened do/while are lost: `o.count = i` becomes `count: 0`, and the key order is wrong. |
| `P1-loops/issue-1722-state-before-loop.js` | The state built before the loop (`arr[0]`, `arr[1]`, and the first iteration) is dropped, and the keys come out shifted (`3,4,5` instead of `2,3,4`). |
| `P3-joins/issue-2354-multiple-returns.js` | The original boolean repro now passes, but with non-boolean arguments `main(0, "", NaN)` returns `NaN` instead of `false`. |
| `P4-paths/issue-2355-truthiness-return.js` | `if (a) return true; return false;` is simplified to `return a`. |
| `P3-joins/issue-2120-havoced-object-access-throws.js` | The catch handler around writes and reads of a leaked object is erased, so a throwing setter or getter escapes. |
| `P6-havoc/issue-1750-lazy-cache.js` | The lazy cache in an optimized function is baked in: `a1,a1,b1,a1` instead of `a1,a2,b1,a3`. |
| `P6-havoc/issue-1750-lazy-singleton.js` | `cached = cached \|\| {}` creates a new object on every call, so singleton identity is lost. |
| `P7-environment/date-local-timezone.js` | `new Date(2020,0,1).getTime()` and `getTimezoneOffset()` are folded using the build machine's time zone. |
| `P7-environment/window-global-alias.js`, `intl-number-format.js` | Feature detection (`typeof window`, `typeof Intl`) is folded against Prepack's own environment. |
| `P7-environment/{local-storage-init,navigator-user-agent,node-require-module,process-env-branch,request-animation-frame}.js` | A reference to an unmodeled global compiles, with no diagnostic, into a program that unconditionally throws `ReferenceError` (`residualThrows`). |

### CRASH where the recovered output is also wrong

These runs report an error, but the CLI still prints code, and that code is wrong: `P2-recursion/deep-clone.js`, `P3-joins/catch-rethrow-abstract.js`, `P3-joins/issue-2120-try-catch-abstract-call.js` (PP0021: the catch is dropped), `P3-joins/nested-returns-side-effects.js`, `P4-paths/truthiness-ternary-mixed.js`, `P5-ranges/conditional-pop-length-arith.js`, `P6-havoc/abstract-fn-leaks-global-object.js` (PP0017), and `real-world/react-like-render.js`.

### Notes

- **P1:** every loop test with an unknown trip count CRASHes. Most fail with PP0001 and an empty message, the #2396 symptom, and are then recovered by pure-scope bail-out. With `return`, `throw`, labels or a Babel `for-of`, it is PP0035/PP0037. A for-in over an abstract object is PP0013.
- **P2:** `fib-optimized`, `gcd-recursive` and `tree-walk-sum` time out after 30s: Prepack unrolls them without bound. The global-code ones hit PP0045 (maximum stack depth).
- **P3:** PP0021 (possible throw inside try/catch) is the dominant error. `switch` on an abstract value works for the simple case, but fails with fall-through (`issue-1378-switch-fallthrough.js`, PP0001).
- **P5:** #1066 still fails (PP0001). With three conditional pushes in global code, the result is a different error, PP0019 "An abstract value with the same name exists".
- **P7:** the residualThrows cases arguably need a modeling mechanism such as `__assumeDataProperty` or a type-derived model (Phase 2B), not a core fix. They are still counted as WRONG because Prepack reports success.
- **P8:** the init-time table cases (`unrolled-table-1000.js` at 70x, `crc32-table.js` at 9x, `repeated-defaults-objects.js` at 6x) are the clearest targets for the cost model.
- `P7-environment/number-to-locale-string.js` throws a FatalError (`TODO #1005: implement Date.prototype.toLocaleDateString`) with no diagnostic attached, which the CLI asserts can't happen.
