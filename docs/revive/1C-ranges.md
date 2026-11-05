# Track 1C: Numeric Range Domain (`IntervalDomain`) & Bounded Abstract-Length Arrays (P5)

## 1. Problem Overview

In upstream Prepack, any numeric fact beyond a finite set of concrete constants in `ValuesDomain` (or a single type tag in `TypesDomain`) was lost:

1. **Issue #1066 (conditional `push`)**: After `if (x) a.push(42);`, `a.length` becomes `x ? 1 : 0` (an `AbstractValue`). A subsequent `a.push(23)` immediately failed with `PP0001` inside `To.ToLength` (`ToNumber` -> `reportIntrospectionError`) and `ArrayValue.prototype.$DefineOwnProperty` (`oldLen.throwIfNotConcrete()`), even though `a.length` is provably an integer in `[0, 1]` and `len + 1 > 2^53 - 1` is provably `false`.
2. **Computed indices and clamped bounds**: Expressions such as `table[n & 3]` or `Math.max(0, Math.min(3, n | 0))` have `ValuesDomain.topVal` because `n` is unbounded, even though bitwise `& 3` and `Math.min`/`Math.max` restrict the result to `[0, 3]i`.
3. **Root cause of `PP0019` in `P5-ranges/conditional-push-global-many.js`**: This failure happens before any `push` executes. Lines 4 and 6 of `conditional-push-global-many.js` both call `__abstract("boolean", "(true)")` with the same intrinsic name `"(true)"` and without `{ allowDuplicateNames: true }`. `createAbstract` (`src/intrinsics/prepack/utils.js`) intentionally rejects duplicate `__abstract` names with `PP0019` (verified by `test/error-handler/abstract-value-check-dup-name-string.js`). Adding `P5-ranges/conditional-push-global-many-unique-names.js` with distinct names (`"(true)"`, `"(false)"`, `"(!0)"`) exercises the actual 4-push global scenario and passes within the 2x size budget.

---

## 2. `IntervalDomain` Design (`src/domains/IntervalDomain.js`)

An `IntervalDomain` element represents a sound over-approximation of the runtime values of a known-numeric `Value`:

- `lo: number`, `hi: number`: closed numeric bounds (`-Infinity`..`+Infinity`, with `-0` canonicalized to `+0` on bounds; `lo = hi = NaN` represents the NaN-only singleton).
- `integral: boolean`: every non-`NaN` value is a finite IEEE-754 integer.
- `mayBeNaN: boolean`: whether `NaN` is possible.
- `mayBeNegZero: boolean`: whether `-0` is possible (tracked separately because `1 / -0 === -Infinity` and `Object.is(-0, +0) === false`, whereas `-0 === +0` is `true`).

### Structural derivation and path sensitivity

Intervals are **not** stored as mutable fields on `AbstractValue`. Instead:

1. **Path-insensitive base derivation (`deriveBase`)**: Computed from immutable structure (`ValuesDomain` elements, `kind`, `args`, plus `IntervalDomain.noteDerivation` for temporal `BINARY_EXPRESSION`, `UNARY_EXPRESSION`, and `ABSTRACT_FROM_TEMPLATE` values created by `Generator.deriveAbstract`) and cached in a `WeakMap<AbstractValue, IntervalDomain>`. Because `AbstractValue`s are immutable, this cache stays sound across joins and loop widening.
2. **Supported operations**:
   - Concrete `NumberValue` and finite `ValuesDomain` unions; boolean-to-number `[0, 1]i`.
   - `"conditional"` joins (`a.join(b)`).
   - `+`, `-` (unary & binary), `*`, `%` with IEEE-754 `NaN` checks (`(+Infinity) + (-Infinity)` and `0 * +/-Infinity` widen to `top`, `x % 0` is `point(NaN)`, `-0` preserved appropriately).
   - Bitwise `&`, `|`, `^`, `<<`, `>>`, `>>>`, `~` via `toInt32()` (e.g. `n & 3` -> `[0, 3]i`, `x >>> 30` -> `[0, 3]i`).
   - `Math.min`, `Math.max`, `Math.abs`, `Math.floor`, `Math.ceil`, `Math.round`, `Math.trunc`, `Math.sign`, `Math.clz32`.
   - String `.length` (`"(A).length"` / `"template:(A).length"`): `[0, 2^53 - 1]i` in general, refined recursively for conditionals and string concatenations `a + b` (`[a.lo + b.lo, min(2^53 - 1, a.hi + b.hi)]i`).
3. **Path-condition refinement (`deriveWithPath`)**: When `realm.pathConditions` is non-empty, `IntervalDomain.of(value)` propagates assumed conditions (`<`, `<=`, `>`, `>=`, `===`, `==` and their negations) bottom-up through compound expressions using a per-query `Map` memo, without mutating `baseCache`. Negated relational comparisons (`!(x > 10)`) keep `mayBeNaN = true` unless `x` was already known non-`NaN`, because `NaN > 10` is `false`.
4. **Comparison decision (`IntervalDomain.compare`)**: Wired into `src/utils/simplifier.js` (`decideByIntervals`) to fold `<`, `<=`, `>`, `>=`, `===`, `!==`, `==`, `!=` whenever intervals decide the outcome (respecting `mayBeNaN` and `-0 === +0`).

### Solver Hook Point (for Track 1B / Z3)

```js
IntervalDomain.refinementHook:
  void | ((value: AbstractValue, interval: IntervalDomain) => IntervalDomain)
```

- Invoked at the end of `IntervalDomain.of(value)` **outside** the path-insensitive `baseCache`, so path-sensitive solver answers never leak across branches.
- Its return value is combined via `result.meet(hook(value, result))`, guaranteeing that a solver hook can only tighten bounds and can never widen past proven structural facts.

---

## 3. Abstract-Length Arrays & Bounded Case Splitting

1. **Direct bounded `Array.prototype.push` (`ArrayPrototype.js`)**: When pushing onto an ordinary extensible `ArrayValue` whose `length` is an `AbstractValue` with an integral non-`NaN` range `[lo, hi]` (`0 <= lo <= hi`, `hi - lo < 8`, `hi + items.length <= 2^32 - 1`) and ordinary writable data elements:
   - `len + argCount > 2^53 - 1` is proven `false`.
   - Only candidate slots `idx` in `[lo, hi + items.length - 1]` are updated conditionally (`oldLen === idx - j ? items[j] : prev`), and `O.length` becomes `oldLen + items.length` directly (preserving DAG sharing in conditional length trees instead of rebuilding one-hot length dispatch).
2. **General bounded-length array methods (`defineArrayMethod` + `mapCases` in `src/utils/cases.js`)**: Methods (`pop`, `shift`, `unshift`, `splice`, `slice`, `concat`, `join`, `indexOf`, `includes`, `lastIndexOf`, `every`, `some`, `forEach`, `filter`, `find`, `findIndex`, `reduce`, `reduceRight`, `reverse`, `fill`, `copyWithin`) on an `ArrayValue` whose `length` enumerates to at most `MAX_LENGTH_CASES = 8` integers evaluate per possible length under both the simplified join condition and the raw equality fact `lenVal === c` (plus inverse conditions of sibling cases) and join effects.
3. **`To.ToLength` (`src/methods/to.js`)**: Resolves an `AbstractValue` length to a concrete integer when `IntervalDomain.enumerate` pins it to a single value on the current path.
4. **Element writes and truncation (`ArrayValue.js`, `src/methods/properties.js`)**:
   - `ArrayValue.prototype.$DefineOwnProperty` updates abstract bounded `length` to `max(oldLen, index + 1)` using range comparisons (`index < range.lo` leaves `length` unchanged; `index >= range.hi` sets `index + 1`).
   - `Properties.ArraySetLength` truncates an array with bounded abstract `oldLen` by running the deletion loop down from `range.hi` (deleting already-absent slots `>= actualOldLen` is a no-op).
5. **`join`, `indexOf`, and `includes` with abstract elements**:
   - `join` folds conditional primitive element trees directly into strings (mapping `EmptyValue`/`undefined`/`null` to `""` so internal `__empty` sentinels never leak into `"" + x` runtime coercions).
   - `indexOf` and `includes` fold pure conditional elements and abstract `searchElement` into conditional/logical expressions (`SameValueZero` uses `(x === y) || (x !== x && y !== y)` when both sides may be `NaN`).
6. **Small-range computed property keys & clamped loops**:
   - `OrdinaryGetPartial` (`src/methods/get.js`) and `OrdinarySetPartial` (`src/methods/properties.js`) case-split via `mapCases` when an abstract key enumerates to `<= 8` keys (e.g. `table[n & 3]`, `a[c ? 1 : 2] = 5`).
   - `ForBodyEvaluation` (`src/evaluators/ForStatement.js`) case-splits via `mapCases` when a `for` loop test compares a concrete counter against an abstract bound with `<= 8` enumerable integer values (e.g. `k = Math.max(0, Math.min(3, n | 0))`).

### Pre-existing bugs uncovered and fixed

- `Array.prototype.shift` initialized `let k = 0` instead of spec step 5 `let k = 1`, writing the shifted-out first element to `O["-1"]`!
- `Array.prototype.unshift` on widened arrays omitted `...items` in `UNKNOWN_ARRAY_METHOD_PROPERTY_CALL`.
- `IsArray` (`src/methods/is.js`) returned `false` on an `AbstractObjectValue` union of `ArrayValue`s because `ArrayValue.isSimpleObject()` is `true`.
- `simplifier.js`: `c ? true : false` returned `c` even when `c` was non-boolean and `isCondition` was `false`; `c ? false : true` passed `isCondition = true` unconditionally to `!c`; and `value === x` collapsed `flag ? -0 : +0` to `-0` even though `1 / -0 !== 1 / +0`.

---

## 4. What Remains Unsolved & Why

1. **Arrays with unbounded or wide abstract lengths (`hi - lo >= 8`)**:
   ```js
   // n is an unbounded __abstract("number")
   var a = new Array(n);
   a.push(1);
   ```
   Case-splitting `mapCases` only scales to small ranges (`MAX_LENGTH_CASES = 8`). When `length` has a wide or unbounded range (e.g. `[0, 1000]` or `[0, 2^32 - 1]`), representing the post-`push` heap requires either symbolic indexed array summaries (`forall i: i === oldLen ? 1 : prev[i]`) or residualizing `a.push(1)` in pure/global code.
2. **Unbounded loops over `.length` (`for (let i = 0; i < arr.length; i++)`)**:
   `IntervalDomain` proves `arr.length` is in `[0, 2^53 - 1]i`, which cannot be enumerated; summarizing unbounded loops is Track 1E's responsibility (and relational invariants such as `0 <= i < arr.length` require relational domains or Track 1B's Z3 bridge).
3. **Floating-point division `/` and general non-monotone math (`sin`, `cos`, `pow`)**:
   `IntervalDomain` currently returns `top` for `/` (divisor intervals spanning `[-0, +0]` produce both `-Infinity` and `+Infinity`, and integer `/` loses integrality) and transcendental `Math.*` functions. These can be added incrementally where needed.
4. **`PP0019` on duplicate `__abstract` names (`P5-ranges/conditional-push-global-many.js`)**:
   Intentional diagnostic in `createAbstract` unless `{ allowDuplicateNames: true }` or distinct names are passed.
