# Track React-Prepack: specializing React 18 server rendering for unknown data

**Result:** the revived Prepack compiles a known React 18 app (the shared react-bench app: 30
function components, 944 lines) into a `render(data)` function that never runs React. On all 500
check inputs its output is byte-identical to `ReactDOMServer.renderToString(<App data={data}/>)`.
It is 4.2–5.5× faster than `renderToString` with the JIT and about 9× faster with `--jitless`. That is
within 1.4–2.1× of a hand-written renderer for the same app.

Code: `react-ssr/` (the compiler and the React model), the Prepack changes listed under "Prepack
changes" below, and `react-bench/impl/prepack.js` (the plug-in for the shared harness).

## Decision: our own model of the React 18 SSR path, evaluated by Prepack

There were three options:

| | Approach | Verdict |
|---|---|---|
| (a) | Modernize `src/react/` (the 2018 reconciler and `experimental-server-rendering`) | Rejected. It is tied to React 16 internals and to Prepack's React mocks. It folds an element tree in TypeScript-like Flow code that then has to re-implement every React and DOM rule a second time, and it never handled `.map` over unknown arrays (#2141). |
| (b) | Evaluate the real `react-dom/server` with abstract data | Tried, see below. Prepack does not fail, but it does not fold React away either: the output keeps Fizz. |
| (c) | **A small port of the Fizz `renderToString` path written for Prepack** (`react-ssr/runtime.js`, ~1.3k lines), run by Prepack as ordinary JavaScript | **Chosen.** |

How (b) went (`renderToString` from `react-dom-server-legacy.node.production.min.js` and
`react.production.min.js`, on a 3-element app with an abstract `name` and `items`): Prepack
finishes in 31 s without a fatal error. The output, though, is 140 KB and 5.7k lines: Fizz's
request/task/segment machinery (`pingedTasks`, chunk arrays, the `Map` caches, the work loop) stays
residual, because the renderer mutates long-lived global state (`currentlyRenderingTask`, the
request, the destination) inside loops over abstract children. That is exactly what the
nested-callback and loop machinery cannot summarize (see "What remained hard"). The residual
program also failed at runtime in that harness. Making (b) work means rewriting what Fizz does
with its state, which is (c).

The model in (c) is a port, not a re-design: the functions keep Fizz's names and structure
(`pushStartInstance`, `pushAttribute`, `pushStyle`, `pushInput`, `pushStartOption`,
`renderElement`, `pushTreeContext`, ...), with three systematic changes:

1. **Strings instead of chunk arrays.** Each `push*` returns the markup string it would have pushed.
2. **No state that outlives a render or leaks across nested work.** There are no caches. Render
   state (tree context, the text-separator flag, format context, context values, the useId
   counter) lives in one `state` object, and every function restores what it changes before it
   returns. Prepack needs this: the item renderer of an unknown-length list is specialized once as
   the callback of a residual loop, which is only allowed if the callback has no net effect on
   outer state.
3. **Explicit unknown-value paths through a host interface** (`HOST.isAbstract`, `HOST.types`,
   `HOST.condParts`, ...). The model asks Prepack what it knows about a value and either folds it,
   or emits a call to a small self-contained runtime helper (`react-ssr/helpers.js`: HTML escape,
   tree id arithmetic, rendering a child of unknown type), or bails out (`__bailout`, a fatal
   diagnostic).

The attribute tables (`properties`, `isUnitlessNumber`, reserved props, boolean and
overloaded-boolean attributes) are copied **verbatim** from react-dom 18.3.1
(`react-ssr/dom-tables.part.js`). The same model also runs in plain Node (`compiler.interpret`)
and matches react-dom on 500/500 inputs. This keeps the model honest independently of Prepack.

### Pipeline (`react-ssr/compiler.js`)

1. **Source transform.** `createElement("tag", ..., xs.map(f), ...)` children (also through aliases
   like `var h = React.createElement`) become `__SSR.mapChildren(xs, f)`. When `xs` has unknown
   length, the renderer then fuses "map, then render each element" into one residual loop.
   Element objects are never materialized at runtime.
2. **Schema.** The type of the data is either given or inferred from training inputs: unions of
   undefined/null/boolean/number/string/object/array, with nested properties and array element
   types. It becomes a Prepack argument model. The shape language gained a `union` kind (see
   below), so `topReview: undefined | null | {...}` is modelled precisely instead of as top.
3. **Prepack.** `__optimize(__ssrRender, model)`. The app module and React's API (`createElement`,
   hooks, context, memo, forwardRef, Component) are the model's own implementations.
4. **Post-pass** (purely syntactic): a `xs.map(f)` result used once by `.join("")` becomes a string
   accumulation loop (`__ssrMapJoin`), and string concatenations are reassociated so that adjacent
   literals merge.
5. **Runtime guard.** A validator generated from the schema runs first. Data outside the schema
   goes to a fallback, which is `renderToString` in the bench plug-in; without a fallback it throws.
   No path renders data the code was not specialized for.

## Supported

- Function components, props, children, defaultProps, `React.Fragment` (keyed or not), `<>`,
  StrictMode/Profiler, `forwardRef`, `memo`, class components (constructor state,
  `contextType`, `getDerivedStateFromProps`, `render`), and `Context.Provider` / `useContext` /
  `Context.Consumer`.
- Hooks with first-render semantics: `useState`/`useReducer` (initial state), `useMemo`,
  `useCallback`, `useRef`, `useId` (exact `:R…:` / `…H…` format, including ids inside lists of
  unknown length, through a lazy tree context that is only materialized when `useId` reads it),
  `useSyncExternalStore` (server snapshot), `useTransition`/`useDeferredValue`, and effects as no-ops.
- DOM serialization as in react-dom 18.3.1: attribute names and aliases, boolean,
  overloaded-boolean and numeric attributes, `data-*`/`aria-*` booleans, `on*` dropped, `style`
  (hyphenation, `px`, unitless properties, custom properties, trimming), `dangerouslySetInnerHTML`,
  `input` (`checked`/`value` last), `select` `defaultValue` → `selected=""`, `textarea` (leading
  newline), `pre`/`listing`, void elements, custom elements, and the `<!-- -->` separators between
  adjacent text nodes.
- Unknown data: conditionals become residual conditionals; lists of unknown length become
  residual loops (with nested lists inside them); unknown strings are escaped at runtime, and
  escaping is distributed over known parts (`"a" + x` → `"a" + esc(x)`); app helpers with loops
  (`groupDigits`, `formatMoney`, the `useMemo` reductions) run as residual loops or as residual
  calls of the original helper.

### Bail-outs (diagnostic `PP1100`, compilation fails; nothing is ever rendered differently)

`React.lazy`/Suspense, legacy context (`contextTypes`, `getChildContext`), `componentWillMount`,
state updates during render, `React.Children` over children of unknown shape, a text node at the
start of an item of an unknown-length list, or a list item that ends in a text node (the
`<!-- -->` separator would then depend on runtime data across items), `<select multiple>` values
of unknown length, and anything else Prepack itself cannot evaluate.

## Results (react-bench, `perf.js` defaults: 3 interleaved rounds of 3 s on a shared 4-vCPU box)

Correctness: `check.js` 500/500 byte-identical (4 edge cases, 471 small pages, 25 large pages).
The schema is inferred from the training corpus (440 inputs disjoint from the check corpus).
None of the 500 check inputs fall back. `react-ssr/test/run.js` also checks a second app that uses
forwardRef/useId, memo with defaultProps, a class component with contextType, Consumer,
useState/useRef/useCallback, textarea/select/input/img and custom CSS properties (300/300
identical), plus inputs outside the schema (all fall back, none are rendered wrongly).

| engine | page | baseline renderToString | prepack | handwritten | prepack speedup | prepack vs handwritten |
|---|---|---:|---:|---:|---:|---:|
| JIT | small (~6 KB) | 0.068 ms | 0.012 ms | 0.009 ms | **5.5×** | 1.4× slower |
| JIT | large (~285 KB) | 3.06 ms | 0.72 ms | 0.49 ms | **4.2×** | 1.5× slower |
| jitless | small | 0.51 ms | 0.057 ms | 0.027 ms | **9.1×** | 2.1× slower |
| jitless | large | 21.1 ms | 2.29 ms | 1.22 ms | **9.1×** | 1.9× slower |

(An earlier run under different machine load measured 4.35×/5.45× JIT and 9.7×/11.6× jitless.)

After merging `revive` (correctness round 2, af1617e5): check.js 500/500 byte-identical, generated
code 83.8 KB (20.6 KB gzip; the merged serializer emits somewhat more code), compile 10.6 s, and
JIT small 5.46× / large 4.68×, jitless small 9.13× / large 9.80× (hand-written: 7.9× / 6.7× /
19.0× / 16.7×). Cold start to first HTML: 16.0 ms (baseline 16.2 ms).

Allocation per render: small 14 KB (baseline 137 KB, handwritten 13 KB), large 749 KB (baseline
6.4 MB, handwritten 606 KB).

Generated code: 72.9 KB (18.6 KB gzip), against 31 KB for `app.js` (React and react-dom are not
needed). Compile time: 13–20 s for the bench app (Prepack), 1.8 s for the feature app. Cold start
from the cached artifact (perf.js): load 11 ms + prepare 2.8 ms + first render 2.2 ms = 16 ms to first HTML
(baseline 17 ms, handwritten 1.8 ms; the load figure is mostly the harness's module resolution, 3.4 ms in isolation). Without a cache, the
first run pays the Prepack compile.

Progression on the large JIT page as the work went on: first correct version 1.7× → lazy tree
contexts, escape distribution and pure helpers 2.3× → residual calls for looping helpers →
map/join loop and concatenation post-pass **4.4–5.3×**.

## Prepack changes (all under `src/`; gates after merging revive af1617e5: serializer 3678/3678 full, error-handler 43/43, hard corpus 187 PASS / 6 CRASH / 1 WRONG / 0 BLOAT, identical per test to revive's own build, lint and flow clean)

Merge notes: revive fixed the `for-in`/`for-of` continue/break join independently (and more thoroughly),
so its version of `ForOfStatement.js` was taken. `serializer/functions.js` keeps revive's
persistent-read tracker (#1750) with net-zero modifications dropped before side effects are
reported. `AbstractObjectValue` keeps revive's `isPure` flag for abstract gets inside the shaped
read. `ArrayValue.createTemporalWithWidenedNumericProperty` keeps revive's
`elementType`/`isPure`/`isDense` parameters, and `argShapes` comes last.

Soundness fixes found on the way (both were silent miscompiles):

- **`src/methods/get.js`: indexing an unknown string** (`s[0]`) read `String.prototype` because the
  wrapper object of an abstract string has no index properties. The result was `undefined`, so
  `s[0] === "\n"` folded to `false`. It now emits `s[i]`. Tests:
  `test/serializer/{abstract,optimized-functions}/AbstractStringIndex.js`.
- **`src/evaluators/ForOfStatement.js` (superseded by revive's own fix at merge): a conditional `continue`/`break` in a `for-in`/`for-of`
  body was dropped.** The body's saved completions were never joined, unlike in
  `ForBodyEvaluation`, so `for (k in o) { if (o[k] == null) continue; s += k; }` ignored the
  `continue`. Test: `test/serializer/optimized-functions/ForInConditionalContinue.js`.

Features:

- **Union shapes** (`src/types.js`, `src/utils/ShapeInformation.js`, new `src/utils/ShapedValues.js`,
  `src/values/AbstractObjectValue.js`, `src/utils.js`): `{kind: "union", variants}` builds a
  runtime discrimination `raw === undefined ? undefined : typeof raw === "string" ? <string view> : ...`.
  `AbstractValue.createShapeView` (a typed view that serializes to the raw value) and arrays of
  unknown length also work as arguments.
- **Shapes flow into nested `map`/`filter` callbacks** (`ArrayPrototype.js`, `ArrayValue.js`): an
  array read through a shape keeps it, and the callback's `(element, index)` arguments get the
  element shape. **Nested callback parameters get unique names** (`residualParameterNames`), which
  fixes a capture bug when two specialized callbacks were nested.
- **Net-zero effects** (`Utils.dropNetZeroModifications`, used for nested callbacks and for
  `__optimize` roots in `src/serializer/functions.js`): a change to an outer binding or property
  that is restored to the identical value before the function returns is not a side effect. This
  is what lets save/restore-style renderer state be specialized.
- **`residualCallHeuristics` option** (`src/options.js`, `prepack-options.js`, `realm.js` (2
  lines), `methods/inlining.js`, `methods/recursion.js`): `false` disables the size and recursion
  heuristics. `"loops"` only turns pure calls with primitive arguments, whose specialization would
  contain a residual loop, into calls of the original function. The default heuristics are
  unchanged.
- `Boolean(x)` on an abstract `x` folds to `!!x` (`intrinsics/ecma262/Boolean.js`).
- Model intrinsics (`src/intrinsics/prepack/global.js`): `__possibleTypes`, `__conditionalParts`,
  `__concatParts`, `__widenArray` (treat an array of unknown length that a residual loop built as
  a widened array, so `map` callbacks over it are specialized), `__residual_pure` (an atemporal,
  shareable residual call), and `__bailout`.

Hot shared files touched: `src/realm.js` (one option field), `src/utils.js` (shaped arguments,
`dropNetZeroModifications`). `src/completions.js`, `src/methods/join.js` and `src/utils/paths.js`
are untouched.

## What remained hard (and why)

1. **Fizz itself is not specializable as written** (option b): it keeps render state in
   module-level variables and request objects that live across the whole render. Prepack can only
   turn a loop or callback over unknown data into residual code if the iteration leaves outer state
   unchanged (or only touches objects it created). A renderer written in "save, mutate, restore"
   style satisfies this once Prepack understands net-zero effects. A renderer with queues and
   caches never does.
2. **Text separators across unknown-length lists.** React's `<!-- -->` depends on whether the
   previous sibling was text, so the state flows from one item to the next. The model supports
   lists whose items start and end with an element (true for every list in the bench) and bails
   out otherwise. A precise solution needs a loop-carried residual variable for the flag, and the
   nested-callback mechanism has no loop-carried state.
3. **Precision of residual helper results.** When a helper with an internal loop becomes a residual
   call (`groupDigits`), the speculative result type is often top, because the loop's string
   accumulator is havocked. Rendering that value then goes through the generic
   `__ssrRenderPrimitiveChild` path rather than a known-string path. A loop-invariant type
   inference ("the accumulator stays a string") would remove these calls.
4. **The remaining 1.4–2× to hand-written code** comes from repeated property reads in the
   generated code (no CSE of `item.sku` across branches), the generic typed-child helper above, and
   per-item closures for nested lists. These are serializer-level optimizations, not React ones.
5. **Compile time** (13–20 s) is dominated by Prepack's speculative evaluations (loop trials,
   speculative inlining checks), so the artifact is cached on disk.

## Reproduce

```
yarn build-prepack
node react-ssr/test/run.js --bench           # feature app + bench app vs renderToString, incl. fallbacks
node /tmp/opencode/pp-wt/react-bench/react-bench/check.js --impl $PWD/react-bench/impl/prepack.js
node /tmp/opencode/pp-wt/react-bench/react-bench/perf.js  --impl $PWD/react-bench/impl/prepack.js --impl handwritten
```
