# Reviving Prepack: attacking the problems the team couldn't solve

The goal is to find out whether the problems that stopped Prepack are now solvable. We work in the real codebase: a fork of `facebookarchive/prepack` at its final state (v0.2.55-alpha, Oct 2018 + upkeep), in `/tmp/opencode/pp-work`, branch `revive`.

## What we're attacking (from the research)

| # | Unsolved problem | Evidence | Today |
|---|---|---|---|
| P1 | **Loops with unknown trip counts.** Prepack only unrolls them, or tries one widening pass. | #1174, #1722, #2396, #2055, #1959, PP0035/PP0037, the hard-coded "6 iterations" limit | FatalError, or the whole function bails out |
| P2 | **Recursion under unknown conditions.** Recursion summarization is disabled. | #1586 (`call.js:400`), #543 (1 line became 1,065) | Unrolls to stack depth; output blows up |
| P3 | **Joins of return/throw/break under unknown conditions; try/catch.** | Fuzzer bugs #2354, #2355, #2363, #2561; #2120; PP0021; #1378 (switch) | **Silently wrong output** |
| P4 | **Reasoning about path conditions.** The logic engine is hand-rolled, with arbitrary caps. | `utils/simplifier.js`, `utils/paths.js`; #2327, #2563, #2564, #2361; PP0029 | Wrong simplifications, and invariant crashes |
| P5 | **Numeric facts are lost**, e.g. a conditional `push` makes `length` unknown. | #1066 | FatalError |
| P6 | **Objects leaking to unknown code (havoc) and aliasing.** Built-ins are treated as leaking. | #2319 (top bailouts: `RegExp.test`, `indexOf`, `parseInt`), #2179, #2011, #1750 | Over-havocs; precision collapses |
| P7 | **Environment modeling** (DOM, React Native, Node, timers) | #24 (76 reactions), #624, #1003, 3k lines of hand-written mocks | Manual and unchecked |
| P8 | **Output size explosion** | #543 (121 reactions), #2140–#2143 | Output often larger than input |

Out of scope for now:

- Modern-language coverage (generators #712, classes #630, the ES5-lowering dependency). It's real, but it's spec-transcription work, not an unsolved problem. Revisit in Phase 4 if the rest works.
- Every React-compiler specific.

## Ground rules for every agent

- **Scoreboard first.** A fix counts only if a test that was failing, crashing or bloated now passes. It must also cause no regressions in `yarn test-serializer`, and must stay clean under the fuzzer.
- **One area per agent, own branch and worktree.** `src/realm.js` is a shared hot spot. Changes there should be small, named and rebased often.
- Prepack's runner already does differential testing: `__abstract("number", "(5)")` runs with 5 at runtime, and `inspect()` results are compared. New tests use that format, plus the `// does not contain:` and `// expected FatalError:` markers.
- No silent fixes. If something is fundamentally impossible, say so with a minimal example. That is an acceptable outcome too.

---

## Phase 0: Foundation (3 agents in parallel, ~1 day)

**0A. Revive the build** (serial blocker for 0C and Phase 1)
- Get `yarn install`, `yarn build`, `yarn test-serializer`, `yarn flow` and `yarn lint` working on modern Node. Known first blocker: `yarn install` fails because a dependency of `test262-integrator` is fetched over `git://`, which this machine can't reach. Fix: rewrite it to an HTTPS tarball with `resolutions`, or drop the test262 tooling from the dev dependencies.
- Record a **baseline**: pass/fail counts for test-serializer and test-error-handler, plus a sampled test262 run, and the run time of each.
- Deliverable: `BASELINE.md` and a one-command `scripts/scoreboard.sh`.

**0B. Build the hard-case corpus** (no build needed; can start now)
- Turn every issue in the table above into tests under `test/serializer/hard/<problem>/issue-NNNN*.js`. Raw issue text is in `pp-hard/issues/`; the agent fetches more of it.
- Add variants: unknown loop bounds, `while` loops searching strings, `do/while` building state, recursive fib or tree walks, nested returns, `switch`, try/catch around unknown calls, conditional `push`, lazy caches.
- Each test is tagged with its problem (P1–P8) and its expected current outcome: crash, wrong output, bloat, or pass.
- Add a few **real-world init snippets**: lodash init, a config parser, a lookup-table builder, Babel-lowered `for-of`.
- Deliverable: about 80–120 tests, plus a scoreboard row per problem. Current state: X crash, Y wrong, Z bloat.

**0C. Revive the fuzzer** (after 0A)
- Get `fuzzer/` running and run it for several hours.
- Extend the generator beyond scalars, `if`s and functions to cover loops, try/catch, objects and arrays.
- Turn new failures into minimized tests in the 0B corpus, then tag them.
- Deliverable: a fresh, current list of wrong-output bugs. That list becomes P3's backlog.

## Phase 1: Core fixes (5 agents in parallel, each with its own area)

**1A. Correct joins of control flow (P3).** Area: `completions.js`, `methods/join.js`, the conditional-evaluation paths in `realm.js`.
- Fix the fuzzer's wrong-output bugs first; correctness beats coverage.
- Then implement `switch` on unknown values (#1378) and emitting try/catch for possible throws (PP0021, #2120).
- Decide whether to patch the 10 completion classes or replace them with a single simpler representation (as in the React Compiler HIR). The agent writes a short design note before any rewrite.
- Done when: the fuzzer stays clean on the extended generator overnight, and every P3 corpus test passes.

**1B. Real solver for path conditions (P4).** Area: `utils/paths.js`, `utils/simplifier.js`, plus a new `utils/smt/`.
- **Bridge (decided and prototyped):** a native `z3` process (4.16, installed via pacman) kept running behind named pipes, with blocking `fs.writeSync`/`fs.readSync`. Prepack stays synchronous. Prototype: `/tmp/opencode/z3-bridge/bridge.js`, at 0.044 ms per query. On its first run it found the #2355 counterexample (`a = 0`).
- **Translation:** each JS value becomes a tagged SMT datatype: Num, Bool, Str, Undef, Null or Obj. Prepack's TypesDomain narrows the tag. Numbers are Reals by default; use FP64 where equality, NaN or -0 matter. Strings use Z3's string theory. The translation itself gets differential tests against real Node, because a wrong model makes Z3 confidently prove wrong things.
- **Yes/no questions (implication, feasibility): Z3 becomes the authority.**
  - Keep only trivial rules in front as a fast path (`x ⇒ x`, constants).
  - Hook into `Path.implies` / `impliesNot` and into the condition push in `paths.js`: drop infeasible branches (#2361).
  - Once Z3 is in place, delete the clever implication rules.
- **Rewrites (the simplifier) stay, but are verified:**
  - In test and fuzz mode, every rewrite X→Y is checked: is X ≠ Y satisfiable? If so, report a bug with a counterexample.
  - Rules whose validity depends on a side condition (e.g. "`a` is boolean") ask Z3 for it, given the current path.
  - Later: generate a few candidate rewrites and keep the shortest one Z3 proves equivalent.
- **Timeouts:** each query has a limit. Unknown or timeout means "don't know", which is always safe (keep both branches).
- Done when:
  - the P4 corpus passes;
  - no new PP0029 errors;
  - the whole test suite and fuzzer run with the rewrite audit on, and every unsound rule found is fixed;
  - the overhead is measured.

**1C. Numeric range domain (P5).** Area: `domains/`, plus touch points in `ArrayPrototype`.
- Add an interval/range domain so that `length` after a conditional `push` stays usable.
- Uses 1B's solver for bounds questions when it is available, but must not depend on it.
- Done when: #1066 and the P5 corpus pass.

**1D. Effect summaries for built-ins (P6, part 1).** Area: `intrinsics/`, `utils/leak.js`.
- Mark built-ins as pure / non-leaking when called with unknown arguments: start with #2319's top four (`RegExp.prototype.test`, `Array.prototype.indexOf`, `parseInt`, `Math.abs`), then the rest of the common ones.
- This is where AI genuinely helps. Drafting hundreds of spec-accurate summaries is tedious and was never done. Each summary must come with a differential test.
- Done when: no leaks are reported for summarized built-ins, and their tests pass.

**1E. Loop and recursion summarization (P1, P2).** This is the hardest problem, so it gets 2 agents.
- **1E-i. Loops** (`evaluators/ForStatement.js`, `WhileStatement.js`, `methods/widen.js`, `realm.evaluateForFixpointEffects`). Implement #1174:
  1. When a loop's heap effects can be summarized as "unknown properties on known objects plus updated bindings", emit a **residual loop** instead of unrolling.
  2. Keep the state built before the loop (#1722).
  3. Remove the PP0037 limits (`return`/`throw`/labels in a bailed-out loop).
- **1E-ii. Recursion.** Re-enable and fix `abstractRecursionSummarization` (#1586): emit a residual specialized function instead of unrolling.
- Coordination: 1E is the heaviest user of the `realm.js` hot spot, so it merges after 1A's first round.
- Done when: the P1 and P2 corpora pass, and #543 produces output smaller than its input.

## Phase 2: AI in the analysis loop (3 agents in parallel; needs 1B and 1E)

Here we test the "we have AI now" claim directly, rather than just using AI to write the code.

**2A. AI-proposed loop invariants, checked by machine.** When 1E's widening loses precision, ask a model for a candidate loop summary or invariant. Examples:
- "`arr` keys 0..i-1 are `'x'` and `i <= n` after the loop"
- "this loop is `text.replace(/\n+$/)`"

Prepack and Z3 then check the proposal: it must hold on entry, and one more iteration must preserve it. Accept only verified summaries.
- Measure what fraction of the P1 loops that 1E couldn't handle become solvable.
- Done when: we have a measured result, positive or negative.

**2B. Environment models from types (P7).** Generate Prepack environment models (`__abstract` shapes, purity annotations) from TypeScript `.d.ts` files, such as `lib.dom.d.ts` and `@types/react-native`. A model drafts the semantics that types can't express: purity, which callbacks run synchronously, timers. Check them by differential runs against jsdom or Node.
- Done when: the React DOM bundle gets past its PP0012 `document` failure, and models for a chosen subset have tests.

**2C. Cost model for output size (P8).** At each specialization decision (unroll vs residual loop, inline vs call), estimate the size and speed cost and pick the cheaper one. Optionally tune on the corpus.
- Done when: no corpus case comes out larger than its input without explicit opt-in, and output size and run time are tracked for every test.

## Phase 3: Integration and verdict (1–2 agents)

- Merge the branches, run the full scoreboard and overnight fuzzer, and test262 for regressions.
- Real-world evaluation: lodash, the React SSR hackathon benchmark, an init-heavy bundle, and a React Native–style module system.
  - Metrics: output size, startup time.
  - Compare against the original input, Prepack 0.2.54, Terser, and Node startup snapshots.
- Write the **verdict**, per problem P1–P8: solved, partly solved, or still impossible (with the minimal reason). Also: what AI contributed (writing the code vs being part of the analysis), and whether the result is worth continuing.

## Phase 4 (optional, if Phase 3 is positive)

Modern-language support without the ES5 lowering (generators, async, classes), and React compiler revival experiments.

---

## Parallelism at a glance

```
Phase 0:  [0A build] ──┬──> [0C fuzzer]
          [0B corpus] ─┤
                       v
Phase 1:  [1A joins] [1B Z3] [1C ranges] [1D builtins] [1E-i loops] [1E-ii recursion]
                        \________________________________/
                                       v
Phase 2:  [2A AI invariants] [2B env models] [2C cost model]
                                       v
Phase 3:  [integration + verdict]
```

Most agents in flight at once: 3 in Phase 0, 6 in Phase 1, 3 in Phase 2.

## Risks we know about

- **Old tooling.** Flow 0.8x, Babel 7.0 and Jest 23 may not run on Node 26. Fallback: run under Node 10/12 via `npx node@12`.
- **Z3 is async in JS.** It is solvable (worker plus `Atomics.wait`, or a native pipe), but adds latency. 1B benchmarks it first.
- **`realm.js` and the completion classes are tangled.** 1A might find that a clean fix needs a rewrite of the control-flow representation. Escalate before starting that.
- **The honest outcome may be "partly."** P1 (loops) is undecidable in general; the question is how much of real-world code becomes tractable. We define success up front as the corpus pass rate going from baseline to ≥70% on P1–P6, with zero known wrong-output bugs.
