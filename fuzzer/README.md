# Prepack fuzzer

This is a differential fuzzer. It generates small random programs, optimizes their `main` function with `__optimize`, and compares what the Prepacked program computes with what plain Node computes. The original generator is Caleb Meredith's (PR #2374): scalars, ifs, conditionals and functions. It is kept as `--mode classic`. `--mode extended` (the default) covers much more of the language.

## Quick start

```sh
yarn build-prepack                        # in the repo root (or your worktree): babel src -> lib
yarn fuzz --time 300                      # 5 minutes, extended mode, all CPUs, then minimize
yarn fuzz --mode classic --time 300 --seed 1
yarn fuzz-sample --mode extended --seed 7 --count 2 --run   # print programs (and run them)
yarn fuzz-minimize path/to/failing.js     # reduce one program by hand
```

`yarn fuzz` runs `yarn install` inside `fuzzer/` first (it has its own `package.json` and lockfile) and then `node src/fuzz.js` with your arguments. Inside `fuzzer/` you can run `node src/fuzz.js ...` directly.

To fuzz another worktree's build, point `--prepack` at it. It accepts the worktree root, its `lib/` directory, or `lib/prepack-node.js`:

```sh
node /tmp/opencode/pp-wt/fuzz/fuzzer/src/fuzz.js --prepack /tmp/opencode/pp-wt/joins --time 600 --mode extended
```

## Options

| Option | Meaning |
|---|---|
| `--time <s>` | How long to generate and run programs (default 60; `0` runs until Ctrl-C). Minimization runs afterwards. |
| `--count <n>` | Stop after n programs. |
| `--seed <n>` | Base seed. Program *i* uses seed `base + i`, so a `(mode, seed)` pair always regenerates the same program. Default: random (printed at the start). |
| `--mode classic\|extended\|both` | Generator (default `extended`). |
| `--prepack <path>` | Prepack build to test (default `../lib`). |
| `--jobs <n>` | Worker processes (default: number of CPUs). |
| `--timeout <ms>` | Wall-clock limit per program, enforced by killing the worker (default 20000). |
| `--out <dir>` | Output directory (default `fuzzer/out/<timestamp>`). |
| `--minimize <s>` | Minimization budget per picked failure (default 120; `0` turns it off). |
| `--max-minimize <n>` | Minimize at most n wrong-output failures (default 25). Only 2 are picked per distinct invariant/crash message. |
| `--disable a,b` | Extended mode: turn generator features off, e.g. to stop rediscovering a known bug. The features are `loops forin switch try throw labels closures helpers fnargs objects arrays update strings`. |
| `--recover` | Return `Recover` for RecoverableErrors, as the CLI does, and check the recovered output. |
| `--invariant-level <n>` | Prepack `invariantLevel` (default 0). |
| `--fatal-fails` | Also treat clean FatalErrors as failures. |

Ctrl-C once stops generating and goes on to minimization. Press it a second time to quit. The exit code is 1 if any failure was found.

## Classification

Each program is run once by the oracle (plain Node, fresh `vm` context, 2 s timeout) and once through `prepackSources`. The residual code is then run the same way. See `src/run.js`.

| Status | Failure? | Meaning |
|---|---|---|
| `pass` | no | The residual `inspect()` output equals the original. |
| `wrong` | **yes** | Prepack reported success, but the residual computes something else, or throws while loading. These are silent miscompiles, the most important class. |
| `wrong-recovered` | **yes** | Prepack reported an error diagnostic (usually PP0001 from pure-scope recovery) but still returned code, and that code is wrong. The CLI would exit with an error, so this is less severe than `wrong`. |
| `invariant` | **yes** | Prepack threw an Invariant Violation. |
| `crash` | **yes** | Prepack threw another internal exception (TypeError, RangeError, ...). |
| `fatal` | no (counted) | A clean bailout: FatalError or an error diagnostic. Error codes are tallied in the summary. |
| `timeout` / `died` | no (counted) | Prepack took longer than `--timeout`, or the worker ran out of memory or crashed. |
| `invalid` | no (counted) | The program itself throws at top level or doesn't terminate in Node. This is a generator bug and should stay at 0. |

The error handler returns `Fail` for every FatalError and RecoverableError, unless you pass `--recover`.

## Output

`<out>/raw/<status>-<mode>-<seed>.js` holds every failing program, with a comment header (detail, expected/actual output, stack). `<out>/min/<status>-N.js` holds the minimized, deduplicated failures, and `<out>/summary.json` the counts.

Minimization (`src/minimize.js`) is AST based. It deletes statements, array elements and switch cases; replaces `if`, loops, `try` and labels with their parts; and replaces expressions with a subexpression or a literal. It keeps a change only if the program still fails the same way: the same status, plus the same normalized message for invariants and crashes. Candidates are checked in parallel on the worker pool. Statement-level edits run to a fixpoint first, then the expression-level ones.

The reducer only checks that the program still fails for the arguments in `inspect()`. It may therefore delete fuel guards and leave loops that would never end for other inputs. Clean up such repros by hand before adding them to the corpus (see `test/serializer/hard/fuzz/`).

## Program shape

Every program has the format of the hard corpus (`test/serializer/hard/README.md`), so a minimized failure can go into the corpus almost as is:

```js
(function () {
  "use strict";
  function h1(p1) { ... }            // helpers (extended) or f1, f2, ... (classic)
  function main(a1, a2, a3) { ... }
  if (global.__optimize) __optimize(main);
  global.main = main;
})();
inspect = function () {
  function fmt(v, d) { ... }         // deterministic printer: -0, NaN, strings, arrays, objects, Errors
  var fns = [ ... ];                 // functions passed as arguments (unknown to Prepack)
  var args = [[...], [...], ...];    // several argument tuples, mixed types
  // calls main on each tuple and catches throws: "throw Error(E1)", "throw TypeError", ...
};
```

### Extended generator (`src/extended.js`)

- Arguments mix numbers (`0`, `-0`, `NaN`, `Infinity`, `0.5`, ...), strings, booleans, `null`, `undefined`, and occasionally `[1, 2]` or `{a: 1, p0: "q"}`. Some parameters always receive functions from `fns`: identity, `typeof`, `+`, a function that throws, `!`, and one that mutates an object argument. Prepack sees calls to unknown functions.
- Statements: `var`, assignment, `+=` and `++`, if/else-if/else, `for`, `while`, `do-while`, count-down `for` loops with abstract start values, `for-in`, `break`/`continue` (also to labels), labeled blocks, `switch` with fall-through and `default`, `try`/`catch`/`finally`, `throw` (Error objects or arbitrary values), conditional `return`, object property writes (static and computed keys, `delete`), array `push`/`pop`/index writes, and closures that capture and modify locals.
- Expressions: arithmetic, comparison, logical and conditional operators, `typeof`, `!`, `-`, `+`, string operations (`length`, `charAt`, `indexOf`, `slice`, `toUpperCase`, `split`), `String`/`Number`/`Boolean`/`isNaN`/`parseInt`/`Math.abs`/`max`/`min`, object and array literals, property and index reads, `in`, `join` and `indexOf` on arrays, and calls to helpers, closures and function arguments.

### Termination and determinism (keeping the oracle trustworthy)

- Every loop is bounded by a counter of at most a few iterations, in addition to its abstract condition. Counters are never written by other generated code.
- No recursion: helpers only call earlier helpers.
- Objects declared in a nested block are only used inside that block, so a branch that didn't run can't cause a TypeError. Scalars are function scoped, and reading `undefined` is fine.
- `for-in` bodies get no way to add properties to objects, because the visiting order of added properties is implementation defined.
- No `Date`, `Math.random`, or function `toString`. Function values print as `fn`. Native errors print only their name (`TypeError`), never V8's message text. User errors print `Error(message)`.
- A generator run of 1600 programs (800 seeds × 2 modes) was executed twice in plain Node: 0 nondeterministic and 0 invalid programs.
- Classic mode pins testcheck's seed (`check(..., {seed})` with a fixed size), so classic programs are reproducible from their seed too.

## Files

| File | Role |
|---|---|
| `src/fuzz.js` | CLI driver: pool, stats, raw failures, minimization, summary |
| `src/pool.js` | Worker pool with per-task timeouts. Workers are killed and replaced after a timeout or crash, and recycled every 250 tasks. |
| `src/worker.js` | Generates and/or runs one program per message |
| `src/run.js` | Oracle and Prepack execution, classification |
| `src/generate.js` | Mode dispatch |
| `src/classic.js`, `src/gen.js` | The original testcheck generator, adapted to the shared program shape |
| `src/extended.js` | The extended generator |
| `src/program.js` | Shared program and harness emission |
| `src/minimize.js` | AST reducer (also a CLI) |
| `src/sample.js` | Print (and optionally run) programs |
