# Track 1D: Effect Summaries for Built-ins and Havoc Reduction (P6, Part 1)

## Problem & Root Cause

In upstream Prepack, most ECMA-262 built-in implementations in `src/intrinsics/ecma262/` call `.throwIfNotConcrete()` as soon as an argument or receiver is abstract. That caused two cascading failures (tracked in `#2319`, where `RegExp.prototype.test`, `Array.prototype.indexOf`, `parseInt`, and `Math.abs` were the top four bailouts in Facebook's internal bundle with counts 275 / 201 / 176 / 58):

1. **Fatal `PP0001` diagnostics even inside `__optimize` functions.** `tryToEvaluateCallOrLeaveAsAbstract` (`src/evaluators/CallExpression.js`) sets `realm.suppressDiagnostics = true` before speculatively evaluating a call, but `src/prepack-cli.js`'s `errorHandler` ignores `suppressDiagnostics` for `FatalError`s. Every `.throwIfNotConcrete()` inside a built-in recorded a fatal `PP0001` before pure-scope recovery even ran. Even `Math.*`, which had a template fast path, guarded it with `To.IsToNumberPure(realm, arg)`, which is `false` for untyped parameters (`Value`) of `__optimize` functions.
2. **Over-havocing and loss of result types on fallback.** When `tryToEvaluateCallOrLeaveAsAbstract` caught `FatalError` (or when `EvaluateCall` dispatched an unknown method), `generateRuntimeCall` called `Leak.value(realm, arg)` on *every* argument and returned an untyped `Value`. Unfrozen objects passed to identity-only built-ins (such as `indexOf` or `Object.is`) were havoced, and downstream expressions like `Math.abs(x) + 1` or `Math.log10(...).toFixed(3)` lost type information and triggered `PP0008` or dynamic call bailouts.

## Architecture of the Solution

### 1. Summary Hook on `NativeFunctionValue`
`NativeFunctionValue` (`src/values/NativeFunctionValue.js`) now carries an optional `summary` callback invoked at the start of `callCallback` whenever `newTarget === undefined` (so `new Number(...)`, `new String(...)`, `new Boolean(...)` retain wrapper-constructor semantics). All summaries are installed from a single table-driven module, `src/intrinsics/summaries.js`, at the end of `intrinsics/index.js`.

### 2. Data-Driven Coercion & Effect Classification (`BuiltinSummaries`)
Each declarative `BuiltinSummary` specifies:
- `receiver`: `"ignored" | "string" | "string-value" | "number" | "boolean" | "to-string-tag"`
- `args`: per-parameter `InputKind` (`"number" | "string" | "string-or-symbol" | "json" | "none"`)
- `rest`: `InputKind` for variadic arguments (`"none"` trims ignored extra arguments so e.g. `arr.map(String)` does not retain `arr` in residual calls)
- `result` / `resultType`: static `Value` subtype (`NumberValue`, `StringValue`, `BooleanValue`, `ObjectValue`, `Value`)
- `mayThrow` / `applies`: optional predicates for range errors (`toFixed`, `toPrecision`, `Number.prototype.toString`, `repeat`, `normalize`, `fromCodePoint`, `encodeURI*`/`decodeURI*`) or native fast paths.

Every consumed input is classified into one of four levels:
- `"pure"`: guaranteed not to throw, touch the heap, or invoke user code (concrete primitives other than symbols where disallowed; typed abstract primitives; or `__makeSimple` abstract plain objects verified by `isCoercionPureSimpleObject` to have `%ObjectPrototype%`, no symbols, and no own `valueOf`/`toString`/`toJSON`, avoiding the `#1682` pitfall where concrete `{ valueOf() { ... } }` satisfies `ObjectValue.isSimpleObject()`).
- `"throws"`: might throw a built-in `TypeError`/`RangeError`/`URIError` (e.g. `Symbol` under `ToNumber`/`ToString`, or `null`/`undefined` under `RequireObjectCoercible`), but cannot invoke user code or mutate heap state.
- `"user"`: might invoke user coercion code (`valueOf`, `toString`, `@@toPrimitive`, `toJSON`, `@@toStringTag`), because `value.mightBeObject()` holds (or `value` is a leaked `ObjectValue`).
- `"bail"`: unleaked concrete objects or concrete symbols, left to the native ECMA-262 implementation so concrete side effects and exceptions are evaluated with full precision.

**Residualization (`residualize`):**
- If `!mayThrow` and every input is `"pure"`, the call becomes a pure template `AbstractValue` (`createFromTemplate`), promoted to temporal via `convertToTemporalIfArgsAreTemporal` when any operand is a path-predicated temporal (`#2327`). This works in both global and pure scopes.
- Otherwise, in pure scope only (`realm.isInPureScope() && !realm.instantRender.enabled`), the call is wrapped in `realm.evaluateWithPossibleThrowCompletion`, `Leak.value` is called *only* on inputs classified `"user"`, and `createTemporalFromTemplate` emits a temporal value of the exact `resultType` (with `isPure` left `false` so potentially throwing or side-effecting calls cannot be dead-code-eliminated). Outside pure scope, `residualize` returns `undefined` to preserve baseline diagnostics.

### 3. Custom Summaries for Structured Built-ins (`CustomSummaries`)
- **`RegExp.prototype.test` / `RegExp.prototype.exec`** and **`String.prototype.{replace, search, match, split}`**: For concrete, unleaked `%RegExpPrototype%` instances with no custom properties/symbols, writable `lastIndex === +0`, and no sticky `y` flag (and no `g` flag for `test`, `exec`, `search`), `lastIndex` is guaranteed to remain `+0` after the call. We emit a fresh equivalent RegExp literal without mutating or leaking the original `RegExp` object. `exec` and `match` emit temporal values (`{ isPure: true }` when string coercion is pure) because each call allocates a fresh match `Array` (or `null`). `replace` and `split` also handle primitive non-RegExp search/separator values.
- **`Array.prototype.{indexOf, lastIndexOf, includes}`**:
  - On known plain concrete arrays with concrete `fromIndex` (`<= 32` elements), folds to a pure `===` conditional chain (`indexOf`/`lastIndexOf`) or `SameValueZero` (`x === e || (x !== x && e !== e)`) disjunction (`includes`), never leaking `searchElement` or elements.
  - On concrete arrays with abstract `fromIndex`, or generic `Array.prototype.{indexOf,lastIndexOf,includes}.call(list, searchElement, fromIndex)` on an abstract receiver, `searchElement` is classified `"none"` because ECMA-262 `StrictEqualityComparison` and `SameValueZero` never coerce, trap on, or escape `searchElement`.
- **`Array.prototype.join` / `Array.prototype.slice` / `Array.isArray`**:
  - `join` on plain concrete arrays folds directly to `+` string concatenation when the separator is concrete and elements are string/number/boolean/null/undefined, and otherwise emits `[...].join(sep)`; also supports `Array.prototype.join.call` on abstract receivers.
  - `slice` on plain concrete arrays of primitives with abstract `start`/`end` returns `ArrayValue.createTemporalWithWidenedNumericProperty` in pure scope (preserving downstream `.join`, `.map`, `Array.isArray`), avoiding object-aliasing hazards by restricting the concrete-array fast path to non-object elements.
  - `Array.isArray` folds conditionals/sets of known arrays or non-arrays and otherwise emits `Array.isArray(x)` in pure scope with classification `"throws"` (only revoked proxies throw; `x` is never leaked).
- **`JSON.stringify`**: Recursively inspects concrete plain objects and arrays (verifying no cycles, no `Proxy`, no accessors, no `toJSON` anywhere on the prototype chain, and no `"__proto__"` own key) that contain abstract leaf fields, emitting `JSON.stringify({ ... })` of type `StringValue` without leaking the outer container (fixing `real-world/url-router.js`). Also handles single-argument unknown values when `values.isTop()`.
- **`Boolean`**, **`Object.is`**, **`Object.prototype.hasOwnProperty`**, and algebraic prefix/suffix folding on `(prefix + x).indexOf/startsWith/includes` and `(x + suffix).endsWith/includes`.

### 4. Companion Havoc & Soundness Fixes
- **`src/values/ArrayValue.js` & `src/intrinsics/ecma262/ArrayPrototype.js`**: Fixed an misplaced `else` branch in `createArrayWithWidenedNumericProperty` where callbacks of `.map`/`.filter` on widened arrays were never leaked when `arrayNestedOptimizedFunctionsEnabled` was `false` (which previously miscompiled `real-world/react-like-render.js`), added missing `Leak.value` calls on callbacks of widened `every`/`find`/`findIndex`/`forEach`/`reduce`/`reduceRight`/`some`/`sort`, guarded `map`/`filter` against `NativeFunctionValue` or abstract callbacks, and fixed upstream's wrong `BooleanValue` invariant type on widened `forEach` (`UndefinedValue`) and `copyWithin` (`Value`).
- **`src/intrinsics/ecma262/Object.js`**: Added `Leak.value(realm, obj)` when `Object.{keys,values,entries}` is called in pure scope on an `AbstractObjectValue` (e.g. `c ? localObj : other`), so `localObj`'s pre-call properties are materialized before `Object.keys` runs.
- **`src/intrinsics/ecma262/Math.js`**: Fixed concrete `Math.*` to coerce only `Math.min(originalLength, length)` arguments for fixed-arity functions rather than `originalLength`.
- **`src/utils/simplifier.js`**: Fixed `#2355` (`c ? true : false` returning `c` instead of `makeBoolean(realm, c)` when `!isCondition`, and `c ? false : true` passing `isCondition = true` instead of `isCondition`), which had previously been masked in `P4-paths/truthiness-ternary-mixed.js` by `Array.prototype.join`'s `PP0001` crash. (Isolated in commit `12784241` for easy reconciliation with Track 1B.)

## Built-ins Summarized vs. Deliberately Not Summarized

### Summarized (81 intrinsics)
- **Global (8)**: `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`, `encodeURIComponent`, `decodeURI`, `decodeURIComponent`
- **`Math` (34)**: `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atanh`, `atan2`, `cbrt`, `ceil`, `clz32`, `cos`, `cosh`, `exp`, `expm1`, `floor`, `fround`, `hypot`, `imul`, `log`, `log1p`, `log10`, `log2`, `max`, `min`, `pow`, `round`, `sign`, `sin`, `sinh`, `sqrt`, `tan`, `tanh`, `trunc` (`Math.random` was already modeled)
- **`Boolean` (3)**: `Boolean`, `Boolean.prototype.toString`, `Boolean.prototype.valueOf`
- **`Number` (10)**: `Number`, `Number.isFinite`, `Number.isInteger`, `Number.isNaN`, `Number.isSafeInteger`, `Number.prototype.toExponential`, `Number.prototype.toFixed`, `Number.prototype.toPrecision`, `Number.prototype.toString`, `Number.prototype.valueOf` (`toLocaleString` was already modeled)
- **`String` (22)**: `String`, `String.fromCharCode`, `String.fromCodePoint`, `String.prototype.{charAt, charCodeAt, codePointAt, concat, endsWith, includes, indexOf, lastIndexOf, match, normalize, padEnd, padStart, repeat, replace, search, slice, split, startsWith, substr, substring, toLowerCase, toUpperCase, trim, valueOf}` (`String.prototype.toString` was already modeled)
- **`RegExp` (2)**: `RegExp.prototype.test`, `RegExp.prototype.exec` (non-`g`, non-`y`, simple `lastIndex === +0`)
- **`Array` (6)**: `Array.isArray`, `Array.prototype.{includes, indexOf, join, lastIndexOf, slice}`
- **`Object` & `JSON` (4)**: `Object.is`, `Object.prototype.hasOwnProperty`, `Object.prototype.toString`, `JSON.stringify` (1-arg; `Object.{keys,values,entries,getOwnPropertySymbols}` were already modeled for pure scope and now materialize conditional objects)

### Deliberately Not Summarized (and Why)
- **Stateful `RegExp` calls (`g` or `y` flags on `test`/`exec`, or `lastIndex !== +0`)**: Mutate `re.lastIndex` to an abstract offset dependent on match outcome; left to pure-scope call bailout, which leaks `re` and preserves `re.lastIndex` updates at runtime.
- **`String.prototype.replace` with a callback function**: Invokes user code synchronously with match substrings and offsets; must execute or leak the callback.
- **Locale-sensitive methods (`String.prototype.localeCompare`, `toLocaleLowerCase`, `toLocaleUpperCase`, `Date.prototype.toLocale*`, `Intl.*`)**: Depend on the runtime host's ICU locale/timezone (P7 environment modeling), not build-time state.
- **Mutating `Array.prototype` methods (`push`, `pop`, `shift`, `unshift`, `splice`, `reverse`, `sort`, `fill`, `copyWithin`)**: Mutate receiver indices and `length` in place (already handled for widened arrays via `UNKNOWN_ARRAY_METHOD_PROPERTY_CALL`; general abstract-length mutation belongs to P5 ranges).
- **`Array.prototype.slice` / `concat` on concrete arrays containing mutable objects with abstract bounds**: Slicing `[obj1, obj2].slice(i)` creates an array whose unknown elements may alias `obj1` or `obj2`; without `#2179` alias sets on arbitrary widened arrays, writing `res[0].x = 2` could miss `obj1.x`. Restricted to primitive elements on concrete arrays.
- **`JSON.stringify` with `replacer` or `space` arguments, or containers with getters/`toJSON`**: `replacer` functions/arrays and `toJSON` run arbitrary user code or filter keys dynamically.
- **`JSON.parse` on arbitrary unknown strings**: Returns an unconstrained object graph (`JSON.js` already handles `JSON.parse(JSON.stringify(template))`).
- **`Object.assign` / `Object.defineProperty` / `Object.freeze` / `Object.seal` on unknown targets**: Mutate target descriptors and integrity levels (`Object.assign` already has dedicated snapshot/partial support in `Object.js`).
- **`Date()` / `Date.now()` / `new Date(...)`**: Environment- and clock-dependent (P7).
- **`Map` / `Set` / `WeakMap` / `WeakSet` / `Promise` / `Reflect` / `Proxy`**: Mutate internal collection slots or schedule microtasks / proxy traps.

## What Remains Unsolved in P6 (and Why)

1. **Method calls on untyped receivers (`arr.indexOf(localObj)` where `arr: Value`)**:
   ```js
   function f(arr) {
     var key = { id: 1 };
     return arr.indexOf(key) + ":" + key.id;
   }
   ```
   When `arr` is an untyped parameter (`Value`), `arr.indexOf` is a dynamic property lookup that might resolve to a user-defined method `{ indexOf(k) { k.id = 2; } }`, not `%ArrayPrototype%.indexOf`. `CallExpression` therefore treats the callee itself as abstract and leaks `key`. Avoiding this without unsoundness requires either type/shape annotations (`Array.isArray(arr)` guard refinement) or emitting a runtime guard `arr.indexOf === Array.prototype.indexOf`.
2. **Lazy module-level caches (`#1750`, `issue-1750-lazy-cache.js`, `issue-1750-lazy-singleton.js`)**:
   ```js
   var cached;
   function get() { return (cached = cached || {}); }
   ```
   `__optimize` evaluates `get` once against the post-init heap (`cached === undefined`) instead of computing an outer fixpoint across repeated calls to optimized functions.
3. **Must/may-aliasing across unknown calls and parameters (`#2179`, `issue-2179-topval-alias.js`, `aliasing-two-params.js`)**:
   ```js
   function f(a, b) { a.x = 1; b.x = 2; return a.x; }
   ```
   Prepack assumes distinct `AbstractObjectValue` parameters do not alias and that fresh unknown return values from `g(obj1)` do not alias `obj1` unless tracked via `Leak` invalidation on every subsequent unknown write.
4. **Global-scope unfrozen object leaks (`#705`, `abstract-fn-leaks-global-object.js`)**:
   Outside pure scope, `Leak.value` emits recoverable `PP0017` (`test/error-handler/call2.js` explicitly tests for `PP0017`) rather than havocing global-scope `ObjectValue` properties into abstract values.
