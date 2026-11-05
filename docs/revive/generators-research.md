# How hard is generator (and async) support?

Research note, 2026-11-05. Tests: `test/serializer/hard/P9-generators-async/`.

## Current state on the merged `revive` build

| Pattern | Result |
|---|---|
| `for…of` over arrays, `[...map.keys()]`, other built-in iterators | Works. Built-in iterators are implemented natively. |
| Generator function **defined** at init, not called | **Wrong:** the serializer drops the `*`, so the output contains `yield` inside a normal function, which is a SyntaxError. |
| Async function defined or called at init | **Wrong (silent):** emitted as a plain function. `load()` returns `1` instead of a Promise, and `p = load()` is serialized as `1`. |
| Generator called and advanced at init (`it.next()`) | Crash: invariant in `Realm.popContext`. `ExecutionContext.suspend()` / `resume()` are empty `TODO #712` stubs (`src/realm.js`). |
| Unstarted generator object in the heap | **Wrong:** serialized as a plain object whose prototype is `Generator.prototype` (via a nonexistent global `Generator`). |
| `Promise.then` during init | **Wrong:** `EnqueueJob` in `src/methods/promise.js` is an empty function. Reactions never run, and the Promise is serialized as a fake object whose `then` throws. |
| `yield` / `await` expressions | `FatalError("TODO #712 …")` (`src/evaluators/YieldExpression.js`, `AwaitExpression.js`). |

The original team never got past [issue #712](https://github.com/facebookarchive/prepack/issues/712), opened in 2017 and still open with 9 comments:

- Caleb Meredith proposed turning every evaluator into a host generator (`yield env.evaluate(…)`) so that interpretation can suspend.
- Herman Venter objected that this might break the abstract interpreter "in subtle yet catastrophic ways". He asked: "how do you iterate an if statement where the condition is abstract?" and wrote "my head start[s] to explode". He suggested compiling generators to an iterator class instead, the way C# does.
- An intern left a design doc and ran out of time.

## The four layers, from easiest to hardest

### 1. Do no harm: preserve function kind (small, about a day)

- Serialize `$FunctionKind` (`generator`, `async`, `async generator`) correctly. The serializer currently only special-cases `classConstructor`.
- Reach `%GeneratorPrototype%` / `%AsyncFunction%` through syntax (`Object.getPrototypeOf(function*(){})`), not through nonexistent globals.
- Calling a generator or async function at init:
  - in global code, a clean FatalError (or leave the call residual);
  - in pure scope, an abstract call that leaks its arguments, as for any unknown function.
- Unstarted generator objects created at init: emit `f.call(this, ...args)` as a residual call when the arguments are serializable.

This removes all of today's silent miscompiles and unblocks the many libraries that merely *define* async functions and generators. That covers almost every modern bundle.

### 2. Promise jobs (small to medium, 1–3 days)

- Implement a job queue on the realm. `EnqueueJob` pushes to it, and after global code finishes, Prepack drains it. Microtasks run right after the script anyway, so this is semantically faithful.
- Serialize settled Promises as `Promise.resolve(v)` or `Promise.reject(e)`.
- **Pending** Promises (waiting on I/O, timers or unknown values) can't be snapshotted: bail out cleanly.
- Under abstract conditions, a reaction may or may not be queued. Start by bailing out.

### 3. Concrete execution of generators and async functions at build time (medium to large, 1–2 weeks with agents)

Three ways to implement suspension:

- **A. Host generators in the evaluator** (Caleb's plan): rewrite about 100 evaluators and many `methods/` to `yield`. It's a huge diff touching everything, and it slows down every evaluation step. Herman's objection stands: Prepack's effect tracking (`evaluateForEffects`, saved completions, path conditions) is built around a call stack, and suspending in the middle of a fork is unsolved.
- **B. Replay.** On each `next()`, re-run the body from the start under `evaluateForEffects` and fast-forward through the first *k* yields. It's simple, but quadratic, and only sound for bodies without external effects before the resume point. Rejected.
- **C. Lower to a state machine inside Prepack (recommended).** Transform generator and async bodies into regenerator-style state machines *for evaluation only*:
  - a closure holding the locals;
  - a `switch` on the state;
  - `try` regions as data.

  Babel's regenerator transform already does this. Prepack then interprets ordinary code, which it is good at, and **a suspended generator becomes a plain object (state number plus locals), which the serializer can snapshot**. That's something no other approach gives. It also answers Herman's question: a yield under an abstract condition gives `state = c ? 3 : 5`, an ordinary abstract value that joins like any other.

  The costs:
  - Residual generator functions must be emitted from the **original** source (keep a map from the lowered function back to the original AST), except when a suspended generator object itself must be serialized. Then the lowered form plus a tiny runtime is emitted, which costs size and loses some fidelity in `toString` and prototypes.
  - The loops track's residual-loop machinery helps with state-machine loops whose bounds are unknown.

### 4. Abstract interpretation of yields and awaits under unknown conditions (hard, research-grade)

With C, it's tractable for bounded state machines. In general it inherits P1 (loops) and P3 (joins). An `await` on an unknown Promise can never be resolved at build time; the rest of the body must stay residual. That's a natural fit for "residualize the continuation", which C makes expressible.

## Recommendation

1. Do **layer 1 now**. It fixes silent miscompiles in a very common pattern, is small, and is required for real-world bundles.
2. Do **layer 2** next. It fixes the Promise miscompile found in the first hands-on test.
3. Prototype **layer 3C** on simple generators (`ids()`, iterators built at init) and measure on the benchmark libraries. Only continue if real libraries actually *run* generators or async code during initialization. Most only define them, which layer 1 already covers.
