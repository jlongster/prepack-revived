# Track F1: modern language support and serializer blockers

Branch `lang`. This note covers what the interpreter and serializer now support, where Prepack deliberately bails out (and why), and the state of generators and async code.

Rule followed throughout: when Prepack can't reproduce a behavior exactly, it stops with a `FatalError` diagnostic (usually `PP0001`) rather than emitting code that might behave differently.

## Supported syntax and built-ins

| Feature | Evaluation at build time | Serialization of residual code |
|---|---|---|
| Optional chaining `a?.b`, `a?.[k]`, `a?.()` | Yes | Yes. Missing parentheses are added before Babel prints (see below) |
| Nullish coalescing `??`, logical assignment `&&=`, `\|\|=`, `??=` | Yes | Yes. `??` mixed with `&&`/`\|\|` is always parenthesized |
| Optional catch binding `catch {}` | Yes | Yes |
| ES2022 class fields, static fields, private fields, methods and accessors, `#x in o` | Yes | Yes, as class syntax |
| Class inheritance from user classes and built-ins (`extends Map`, `extends null`) | Yes | Yes. The base class is always emitted before the subclass |
| `globalThis`, Annex B `__defineGetter__`/`__defineSetter__`/`__lookupGetter__`/`__lookupSetter__`, `{ __proto__: p }` in object literals | Yes | Yes |
| RegExp flags `d`, `s`, `u`, `v`, `y`; named capture groups (`.groups`); `dotAll`/`hasIndices`/`unicodeSets` getters | Yes (delegates to the host `RegExp`) | Yes |
| `Object.fromEntries`, `Object.hasOwn`, `Array.prototype.flat`/`flatMap`/`at`, `String.prototype.trimStart`/`trimEnd`/`at`, `Symbol.prototype.description`, `Promise.allSettled`, `Promise.prototype.finally` | Yes | n/a |
| BigInt literals (`1n`, `0xffn`, `1_000n`), `BigInt()`, `BigInt.asIntN`/`asUintN`, `BigInt.prototype.toString`/`valueOf`/`toLocaleString` | Yes, concretely and per spec | Yes, as literals (`-5n` as a unary minus); boxed BigInts as `Object(5n)` |
| BigInt operators: `+ - * / % **`, `<< >> & \| ^ ~`, unary `-`, `++`/`--`, comparisons with Numbers and Strings, `==`, `===`, `typeof`, truthiness, `JSON.stringify` TypeError, mixing TypeErrors, `>>>` TypeError, RangeErrors | Yes | n/a |
| Generator **functions** and async functions defined at init | Yes | Yes. Function kind is kept (`function*`, `async function`) |
| Generators **called and run to completion** at init (`Array.from(gen())`, `new Map(mapIterator(...))`, `for…of`, `yield*`, `.next(v)`, `.throw()`, `.return()`, `try/finally`) | Yes (see "Generators" below) | The results are serialized; the generator objects themselves are not |
| Promise reactions during init (`then`/`catch`/`finally`, `Promise.all`/`race`/`allSettled`, thenables, async functions that return a Promise) | Yes: a realm job queue is drained after global code | Settled Promises are emitted as `Promise.resolve(v)` / `Promise.reject(e)` |

## Promise job queue (layer 2)

- `EnqueueJob` (`src/methods/promise.js`) pushes onto a per-realm queue. `PromiseReactionJob` and `PromiseResolveThenableJob` follow the spec.
- The queue is drained in `LexicalEnvironment.executeSources` (`src/environment.js`) after global code finishes, before serialization. This matches engines, which run microtasks right after a script ends.
- Jobs queued inside `evaluateForEffects` are stored with those effects and only join the real queue when the effects are applied. Jobs from discarded speculative effects are therefore never run.
- The queue runs at most 10,000 jobs; more than that is a FatalError, which also catches self-rescheduling loops.

### Serializing settled Promises

- **Fulfilled**: `Promise.resolve(v)`. Values that might be thenable (`then` anywhere on the prototype chain, partial or leaked objects) are rejected at visit time, because `Promise.resolve` would adopt them.
- **Rejected**: `Promise.reject(e)`. If the Promise had a handler during init (`[[PromiseIsHandled]]` is true), the output also emits `p.catch(function () {})`. Without it, Node would raise `unhandledRejection` (by default the process exits with `ERR_UNHANDLED_REJECTION`) and browsers would log an error, neither of which the original program did. If the Promise was never handled, no catch is added, so the residual program reports the rejection just like the original.
- **Pending**: FatalError ("Pending Promises cannot be serialized"). The pending state, its reactions and the resolving functions can't be rebuilt as a snapshot.

### Bail-outs

All are FatalError `PP0001`:

- A Promise reaction is created, or a Promise is settled, under an abstract path condition or a saved (conditional) completion. Whether the job gets queued would depend on the condition.
- Promise construction, settlement or reactions in pure scope (`__optimize`d functions). These must stay residual, and the residual code would not reproduce the queueing at build time.
- Jobs queued outside global initialization (for example from an optimized function).
- A handler whose body ends with a conditional abrupt completion.
- Promise resolving functions (`resolve`/`reject`) that escape into the residual heap. They are native closures over internal state and can't be serialized.

### Harness change and observability

`scripts/test-runner.js` and `scripts/hard-scoreboard.js` now run in this order:

1. the script;
2. drain the microtask queue;
3. `inspect()`;
4. drain the microtask queue again.

Before, `inspect()` was called synchronously in the same task as the script. That can't reproduce what a page or Node module sees after its script ends, and it made the job queue untestable. Both the original and the prepacked program run in the same harness, so the comparison is still differential. Both scripts also install no-op `unhandledRejection` listeners so that tests can create rejected Promises.

One remaining difference: code that runs synchronously after the prepacked bundle **in the same task** (for example, another bundle concatenated into the same `<script>`) sees the drained state. In the original program, that code would run before the microtasks. Prepack has always assumed that its input is the whole initialization program, so this is consistent with existing assumptions, but it is worth knowing.

## Generators (layer 3, concrete only)

Calling a generator at build time no longer crashes. `evaluateGeneratorCall` (`src/methods/generator.js`) works like this:

1. It lowers the generator body to a regenerator state machine with Babel (parameters, destructuring, `for…of`, spread, block scoping, then the regenerator transform).
2. It evaluates the lowered factory *inside the generator's closure environment*, so free variables resolve to the same bindings.
3. It uses a private copy of `regenerator-runtime` that is evaluated without effects once per realm.

The resulting object keeps its real prototype (`F.prototype`). `next`/`return`/`throw` are routed through the hidden `$RegeneratorInvoke` slot, so it behaves like a native generator object, and the regenerator internals are never visible as properties.

What works: concrete generators that are created and exhausted (or abandoned) during init. Typical cases are TypeScript's `mapIterator`/`flatMapIterator`, iterator helpers feeding `new Map(...)` and `Array.from`, and `yield*` delegation.

Bail-outs (FatalError):

| Case | Why |
|---|---|
| A generator object still reachable at the end of init (suspended or unstarted) | Its state lives in lowered closures that have no equivalent in the original source. Emitting the lowered form plus a runtime is possible, but it is not done (P9 `generator-suspended-at-init.js` stays a clean CRASH). |
| A generator called or advanced under abstract conditions or in pure scope | Same reasons as Promise jobs. |
| Generator methods that use `super` | The lowered body is evaluated outside a method, so `[[HomeObject]]` is lost. |
| Async generators called at init | Not lowered. |
| The lowering packages (`regenerator-runtime`, `@babel/plugin-transform-*`) can't be resolved | These are currently transitive or dev dependencies of Prepack. A packaged Prepack without them reports a FatalError instead of crashing. **TODO:** declare them as runtime dependencies. |

Abstract `yield`/`await` (layer 4) is not attempted. `await` during init still bails out (`test/serializer/basic/` bailout tests).

## Serializer fixes found on the large workloads

- `??` and optional chains are parenthesized when Babel 7's printer would drop needed parentheses. Without this, the output had syntax errors (`a ?? b && c`) or different semantics (`(a || b)?.c` printed as `a || b?.c`). See `ensureModernSyntaxParentheses` in `src/serializer/serializer.js`.
- **Class emission order.**
  - The base class is emitted before its subclasses, including when they share an insertion point and when the base is serialized later.
  - A class is emitted no later than its first use, but never before values its `extends`, static private fields or computed symbol keys depend on.
  - Function bodies are spliced in one pass per body, from the highest index down, so earlier insertion points stay valid.
- **Arrow functions without `this`/`arguments`** may go into the prelude like function expressions, so that properties defined on them (for example `name`) are emitted after their declaration.
- **Visitor scaling.** Binding resolution is cached, and captured scopes are only re-visited for *modified* bindings. TypeScript went from running out of memory at 7.6 GB to about 1.6 GB and 50 s.
- **Delayed initializers** (`--delayInitializations`) are injected without dropping optimized-function preludes.

## Benchmarks (`node bench/run.js --no-perf`)

| Workload | revive (before) | lang |
|---|---|---|
| marked, d3-scale | OK | OK |
| handlebars-app | WRONG (`globalThis`/`__defineGetter__`) | OK with `browser-opt` (default profile hits an INVARIANT that revive also hits) |
| highlight-js | WRONG | OK |
| typescript | FAIL (PP1004 `??`) | OK with `--closedWorld`. With revive's new open-world default it stops cleanly at `process.platform` / `__filename` probes (environment track) |
| prettier | FAIL (PP1004 `catch {}`) | OK, digest-identical, with `--closedWorld`. With open world it stops cleanly at a `RegExp[Symbol.match]` on an abstract global |
| mathjs | FAIL (PP1004 `1n`) | Parses and evaluates BigInt. It now stops at `seedrandom`'s residual loop (PP0037, loops track) |
| babel-standalone, three | FAIL | FAIL (not language-related) |
