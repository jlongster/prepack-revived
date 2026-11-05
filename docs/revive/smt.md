# Track 1B: Z3 Path-Condition Solver & Rewrite Audit (`src/utils/smt/`, P4)

## 1. Overview

Prepack's original path-condition engine (`src/utils/paths.js`, `src/values/AbstractValue.js`) and expression simplifier (`src/utils/simplifier.js`) relied on hand-written pattern-matching rules with arbitrary recursion caps (`depth > 5` / `depth > 10`). Those hand-written rules suffered from two opposite failure modes:

1. **Silent miscompiles and invariant crashes from unsound rules** (e.g. #2355 `if (a) return true; return false;` -> `return a`; #2354; `x != null` falsely implying truthiness of `x`; `(0 !== x)` falsely implying truthiness of `x`; conditional `===` ignoring `NaN` and non-boolean conditions; cross-branch contamination of `PathConditions` caches).
2. **Lost precision and explored dead branches from missing deductions** (e.g. #2361 infeasible branches triggering `invariant(false, "assuming that false equals true")`, failure to prune `x > 3` under `x > 5` or `x > 20` under `!(x > 10)`, and `ToObject(v)` emitting `Object.assign(v)` even after `v != null && typeof v === "object"`).

Track 1B adds a synchronous native Z3 solver bridge (`src/utils/smt/`), uses Z3 in **audit mode** across the serializer suite and hard corpus to find and fix every unsound simplifier and path-condition rule, and enables Z3 **fallback mode** by default when `z3` is installed to decide implications, prune infeasible branches, and narrow object types.

### Scoreboard Impact (on `smt` branch, pre-integration)

| Suite / Folder | Baseline (`revive` base) | Track 1B (`smt`) |
|---|---|---|
| `P4-paths` (14 tests) | 7 PASS, 3 CRASH, 1 WRONG, 3 BLOAT | **14 PASS, 0 CRASH, 0 WRONG, 0 BLOAT** |
| `P3-joins` (21 tests) | 9 PASS, 7 CRASH, 3 WRONG, 2 BLOAT | **10 PASS, 7 CRASH, 2 WRONG, 2 BLOAT** (`issue-2354` WRONG -> PASS) |
| `fuzz` (5 new P4 repros) | (would be 2 CRASH, 2 WRONG, 1 CRASH/WRONG) | **4 PASS, 0 CRASH, 0 WRONG, 1 BLOAT** |
| Serializer suite (full) | 3378 / 3378 | **3386 / 3386 (100%)** |
| SMT rewrite/implication audit | 3,993 failures on pre-fix rules | **0 failures across 34,047 checks** |

---

## 2. Architecture

### 2.1 Synchronous Native Z3 Bridge (`src/utils/smt/z3.js`)

Prepack's evaluator and simplifier are completely synchronous; making `Path.implies` or `simplifyAndRefineAbstractValue` async would require rewriting every evaluator, domain, and join point. Instead, `Z3Process` keeps a single persistent `z3 -in -smt2` child process (Z3 4.16) alive per Node process behind two POSIX named pipes (`mkfifo` in a temporary directory):

- **Blocking pipe I/O**: Node spawns `sh -c 'exec z3 -in -smt2 < in > out'` (`unref`ed, cleaned up on `process.on("exit")`) and opens `in` for writing and `out` for reading, driving queries synchronously with `fs.writeSync` and `fs.readSync` on a 64 KiB buffer.
- **Framing & incremental scopes**: Every query is wrapped in `(push) ... (check-sat-using (then simplify solve-eqs smt)) (pop)` followed by `(echo "@@PREPACK_Z3_END@@")`. Reading stops as soon as the marker appears in stdout.
- **Fault isolation**: If `z3` is not on `PATH` (or `PREPACK_Z3=none`, or Windows), `findZ3()` returns `undefined` and Prepack runs cleanly with SMT disabled. If `z3` crashes or closes its pipe, `Z3Process` kills the child, restarts up to `MAX_RESTARTS = 3` times (replaying `SMT_PRELUDE`), and then disables itself for the remainder of the process. Every failure returns `"unknown"`, which callers treat conservatively as "not proven".

### 2.2 JS-to-SMT Translation Model (`src/utils/smt/translate.js`)

Every JS value is encoded into an inductive SMT-LIB datatype `JS`, paired with an extended real number sort `N`:

```smt2
(declare-datatypes () ((N (Fin (fv Real)) (NaN) (PInf) (NInf))))
(declare-datatypes () ((JS (Num (jn N)) (Bool (jb Bool)) (Str (js String))
                           (Undef) (Null) (Obj (jo Int)) (Sym (jy Int)) (Empty))))
```

- **Tagged types & domains**: Leaf `AbstractValue`s are declared as `JS` constants constrained only by facts Prepack itself establishes: `TypesDomain` narrows the allowed `JS` constructors (`tagsOfType`; `FunctionValue` additionally asserts `(callable (jo v))`), `ValuesDomain` finite sets emit an explicit disjunction `(or (same v c1) ...)`, and `abstractConcreteUnion` expands to the disjunction of its arms. `IntegralValue` is intentionally **not** asserted as an integer constraint because Prepack assigns `IntegralValue` to integer arithmetic expressions that can overflow 32/53 bits.
- **Numbers (`N`), `NaN`, `±Infinity`, and `-0`**:
  - Concrete IEEE-754 doubles are decomposed exactly as dyadic rationals `m * 2^e` (`m < 2^53` integer) into `(Fin (/ m 2^-e))` or `(Fin (* m 2^e))`, with exact constructors `NaN`, `PInf`, and `NInf`.
  - `===` (`seq`), `==` (`leq`), `<` (`nlt`), `<=` (`nle`), unary `-` (`nneg`), unary `+` (`tonum`), and `ToBoolean` (`truthy`) implement exact IEEE-754 special-case rules: `(neq NaN NaN)` is `false`, any relational comparison with `NaN` is `false`, `(truthy (Num NaN))` and `(truthy (Num (Fin 0.0)))` are `false`, and `(+Infinity) + (-Infinity)` / `0 * ±Infinity` evaluate to `NaN`.
  - **`-0` limitation**: Finite numbers use `Real`, identifying `-0` with `+0` (`(Fin 0.0)`). This is exact for `===`, `==`, `<`, `<=`, `>`, `>=`, `+`, `-`, bitwise ops, and `ToBoolean` (none of which distinguish `-0` from `+0`). For `/` (when the divisor is zero, `1 / -0 === -Infinity` vs `1 / +0 === +Infinity`) and `**` (when the base is zero, `(-0) ** -1 === -Infinity`), the translator emits a fresh unconstrained `N` constant on `(nzero ...)` so Z3 never falsely equates `1 / x` and `1 / y` from `x === y`. `numstr` keys `-0` separately for concrete constants, and `auditRewrite` skips trees containing `-0` literals alongside `EmptyValue` sentinels.
  - **IEEE-754 rounding & overflow limitation**: Binary `+`, `-`, and multiplication by a concrete constant (`constMul`) use exact `Real` linear arithmetic rather than `(FloatingPoint 11 53)` bit-blasting (which measured 100–1000x slower per query). Non-linear `*` (between two symbolic operands), `/` (non-zero divisor), `%`, `**` (non-zero base), and bitwise operators (`&`, `|`, `^`, `<<`, `>>`, `>>>`, `~`) map to an uninterpreted function `(numop opcode a b)`, preserving congruence (`a = b => x % a = x % b`) while keeping queries in fast linear arithmetic.
- **Strings & coercions**:
  - Strings use Z3's native string theory with one character per UTF-16 code unit (`\u{xxxx}` escaping for non-ASCII), matching JS `.length` (`ABSTRACT_FROM_TEMPLATE` `(A).length` on strings translates directly to `(to_real (str.len (js a)))`), `===`, `str.<`, `str.<=`, and `str.++` concatenation.
  - `strnum : String -> N` (`ToNumber`) and `numstr : N -> String` (`ToString`) are uninterpreted functions seeded with ground axioms `(= (strnum "lit") ...)` and `(= (numstr (Fin ...)) "lit")` for every string and number literal present in the query. Symbolic `ToString(computedNumber)` therefore stays soundly opaque.
- **Objects & `ToPrimitive`**:
  - Concrete `ObjectValue`s and `SymbolValue`s receive distinct negative integer identities (`-1, -2, ...`) so distinct known objects cannot alias while unknown `Obj` leaves remain unconstrained.
  - `ToPrimitive` on values that might be objects uses uninterpreted functions `objprim` (default hint, for `+` and `==`) and `objprim_num` (number hint, for `<`, `<=`, `>`, `>=`), constrained to return non-`Obj`, non-`Empty` values.
- **Pure temporals & size caps**:
  - `dischargeValuesFromUnion` and pure scope evaluation often wrap pure expressions into temporal `AbstractValue`s (`intrinsicName = "_$0"` with `isPure === true` in the generator's derived-value table). `pureOperationSpec` + `samePureDescriptor` unrolls and deduplicates these so structurally equivalent temporals map to the same SMT term.
  - To prevent blowups on deeply unrolled loops, `SmtTranslator` enforces `maxNodes = 250` and `depth <= 60`; exceeding either throws `TranslationError`, which `build()` turns into `"unknown"`.
- **Differential testing (`scripts/test-smt.js`)**: Generates 3,000 random depth-3 JS expressions over typed leaves (`number`, `string`, `boolean`, `primitive`, `object`, `any`) and tricky constants (`0`, `-0`, `0.5`, `-0.25`, `NaN`, `±Infinity`, `""`, `"0"`, `" 1 "`, `"-0"`, surrogate pairs, `null`, `undefined`, `{}`, `function(){}`), evaluates them in Node's `vm`, and checks against Z3: **0 soundness failures, 703/703 precise expressions uniquely determined**.

### 2.3 Modes, Slicing, Caching, and Timeouts (`src/utils/smt/index.js`, `src/utils/paths.js`)

| Mode (`options.smt` / `--smt` / `$PREPACK_SMT`) | Behavior |
|---|---|
| `off` | Solver is never spawned or queried (automatic fallback when `z3` is not installed). |
| `fallback` *(default when `z3` is available)* | Hand-written fast-path rules run first; when they return `false`, `Path.implies` / `Path.impliesNot` query Z3, `Path.withCondition` / `Path.withInverseCondition` prune branches Z3 proves infeasible (`smtProvesInfeasible`), and `To.ToObject` elides `Object.assign(v)` in pure scope when `smtIsObject` proves `v` is already an object. |
| `audit` | Everything in `fallback`, plus Z3 checks every simplifier rewrite (`auditRewrite`), every `true` answer from the hand-written implication rules (`auditImplication`), and every condition derived during `pushPathCondition` / `pushInversePathCondition` / `refineBaseConditons` (`auditDerivedCondition`). Counterexamples are extracted via `(get-value ...)` and logged as JSON lines to `$PREPACK_SMT_AUDIT_LOG` (or thrown as `SmtAuditError` when `PREPACK_SMT_AUDIT_THROW=1`). Prepack's internal `EmptyValue` sentinel is skipped in `auditRewrite` because reads promote `Empty` to `undefined` while raw slot checks distinguish it. |

Performance and safety mechanisms:

1. **Relevance slicing (`sliceRelevantAssumptions`) & string-free specialization**: Before building an implication or object-tag query, an iterative bounded traversal (`collectLeafHashes`, capped at 600 steps, stopping at opaque leaves such as `ABSTRACT_PROPERTY`) collects leaf `hashValue`s in the goal and retains only path conditions in the transitive closure of shared leaves (capped at 16 assumptions; `maxNodes = 80` in `fallback` mode, `250` in `audit` mode). Dropping unrelated path conditions is sound by monotonicity of unsatisfiability. In `translate.js`, `numstr` ground axioms are emitted lazily only when `+` (`jadd`) appears in the query, and `<`/`<=`/`>`/`>=` emit pure numeric `nlt`/`nle` (without `str.<`/`str.<=`) whenever at least one operand cannot produce a string primitive, avoiding Z3's sequence solver on purely numeric queries.
2. **Fast-path guards & two-tier caching**:
   - Empty-path / disconnected-leaf atomic checks (`isAtomicAbstractValue`, `expandedChildren`): skips Z3 when no sliced assumptions relate to an opaque leaf goal.
   - Per-`PathConditions` negative caches (`_smtFailedImplications`, `_smtFailedNegatives`, bucketed by `hashValue` + `.equals()`), cleared whenever a new condition is `add()`ed; positive results populate `_impliedConditions` / `_impliedNegatives`.
   - Process-wide query cache (`Map<string, Z3Answer>`, `CACHE_LIMIT = 100000`) keyed by exact SMT-LIB script text, shared across Realm instances, option permutations, and fixed-point re-serialization passes.
3. **Deterministic resource limits & per-Realm query caps**:
   - Uses `(set-option :rlimit 200000)` (`$PREPACK_SMT_RLIMIT`) rather than Z3's `:timeout` flag (which spawns an OS timer thread per check and adds ~2.5 ms overhead per query), plus a deterministic per-Realm cap of `MAX_REALM_FALLBACK_QUERIES = 400` (`realm.smtQueries`, counted prior to cache lookup so outputs stay invariant across cold/warm caches) in `fallback` mode so unrolled speculative loops cannot stall compilation.
   - Overrideable wall-clock timeout via `$PREPACK_SMT_TIMEOUT` plus a 5,000 ms process-level safety ceiling (`HARD_TIMEOUT_MS`).

---

## 3. Unsound Rules Found by the Audit (and Fuzzer)

Running `PREPACK_SMT=audit` on the pre-fix rules across `yarn test-serializer --fast` and the hard corpus produced **3,993 audit failure reports** across 20 call-stack groups. Every unsound rule below was root-caused and fixed (regression-tested in `test/serializer/optimizations/SmtSoundnessTruthinessAndEquality.js`, `SmtPathImplication.js`, `test/serializer/hard/P4-paths/*`, and `test/serializer/hard/fuzz/*`):

### 1. Truthiness ternaries `c ? true : false` and `c ? false : true` (`src/utils/simplifier.js:261-265`)
- **Unsound rule**: Under `isCondition || (x.getType() === BooleanValue && y.getType() === BooleanValue)`, `c ? true : false` rewrote to `c` even when `isCondition === false` and `c` was not boolean. Likewise, `c ? false : true` called `AbstractValue.createFromUnaryOp(realm, "!", c, true, loc, true)` with `isCondition` hardcoded to `true`, so when `c` was `!a`, `negate` stripped `!!` and returned uncoerced `a` (#2355, #2354).
- **Counterexample**: `c = 0` (or audit `x = -Infinity`): `(0 ? true : false)` evaluates to `false`, whereas `0` evaluates to `0`; `(!(-Infinity) ? false : true)` evaluates to `true`, whereas `-Infinity` evaluates to `-Infinity`.
- **Fix**: Return `c` only when `isCondition || c.getType() === BooleanValue`, otherwise `makeBoolean(realm, c, loc)` (`!!c`); pass `isCondition` (not `true`) when constructing `!c`.

### 2. Conditional strict equality `((cond ? xx : xy) === y)` — non-boolean `cond` (`src/utils/simplifier.js:476-487`)
- **Unsound rule**: Rewrote `((cond ? xx : xy) === y)` directly to `cond` (without boolean coercion) when `xx` matched `y` and `xy` did not.
- **Counterexample**: `cond = "yes", xx = "a", xy = "b", y = "a"`: `("yes" ? "a" : "b") === "a"` is `true`, whereas `cond` is `"yes"` (and for `cond = 0`, `false` vs `0`).
- **Fix**: Wrap the positive rewrite in `makeBoolean(realm, cond, loc)`.

### 3. Conditional strict equality `((cond ? xx : xy) === y)` — `!xy.equals(y)` treated as `xy !== y` (`src/utils/simplifier.js:476-487`)
- **Unsound rule**: Used `!xy.equals(y)` (lack of structural `AbstractValue` identity, or `Object.is` inequality on `NumberValue`) to conclude that `xy === y` is `false` at runtime. Two distinct `AbstractValue`s (or `+0` and `-0`) can easily evaluate to the same runtime value.
- **Counterexample**: `cond = 0, xx = 5, xy = y` where `xy` is an abstract parameter equal to `5` at runtime (or from audit on `AbstractOrNullOrUndefined.js`: `(((typeof u === "number") ? (x >= 3) : (typeof u === "number")) === (x >= 3)) ~> (typeof u === "number")` with `u = null, x = -Infinity`, where both `x >= 3` and `typeof u === "number"` evaluate to `false`, so `false === false` is `true` while `typeof u === "number"` is `false`).
- **Fix**: Replaced `!xy.equals(y)` with `strictlyAlwaysNotEqual(realm, xy, y, depth)`, which returns `true` only for concrete values with `!==`, provably disjoint JS types, or when `Path.implies(xy !== y)` holds.

### 4. Conditional strict equality `((cond ? xx : xy) === y)` — `xx.equals(y)` ignoring `NaN` (`src/utils/simplifier.js:476-487`)
- **Unsound rule**: Used `xx.equals(y)` to conclude `xx === y` is always `true` at runtime, ignoring that `NaN === NaN` is `false`.
- **Counterexample**: `cond = 1, x = NaN, y = 5` in `(cond ? x : y) === x` (audit on `ConditionalAbstractObjectValueGetPartial.js`: `((c ? 1 : _$0) === _$0) ~> !c` with `c = false, _$0 = NaN`): `(false ? 1 : NaN) === NaN` is `false`, whereas `!false` is `true`.
- **Fix**: Replaced `xx.equals(y)` with `strictlyAlwaysEqual(realm, xx, y, depth)`, which requires `cannotBeNaN(v)` or `Path.implies(v === v)` (and compares concrete numbers with `===` rather than `Object.is`).

### 5. `negate()` hardcoding `isCondition = true` across double negation and De Morgan (`src/utils/simplifier.js:531, 583-596`)
- **Unsound rule**: `negate` called `simplify(realm, x, true, depth + 1)` on `!x`, omitted `isCondition` when recursing into `&&`/`||` operands under De Morgan, and passed `isCondition = true` to `createFromLogicalOp` and `createFromUnaryOp` even when `negate` was called in value context (`isCondition = false`/`undefined`), allowing inner simplifications to drop boolean coercions.
- **Counterexample**: From audit on `NestedConditions.js`: `(((!a && !b) ? undefined : (a ? 3 : 1)) !== undefined) ~> (a || b)` with `a = Infinity, b = -Infinity`: LHS is `true`, whereas `a || b` evaluates to `Infinity`.
- **Fix**: Threaded `!!isCondition` / `isCondition` through every recursive `simplify`, `negate`, `createFromLogicalOp`, and `createFromUnaryOp` call in `negate()`.

### 6. Wrong variable captured in `CANNOT_BECOME_OBJECT` rewrite (`src/utils/simplifier.js:169-176`)
- **Unsound rule**: In InstantRender mode, simplifying `(xa === xb) || (ya === yb)` when `xa` is `null` and `ya` is `undefined` (testing `xb == null`) called `rewrite(xb)`, whose body passed `[xa]` (`[null]`) instead of `[z]` (`[xb]`) to `CANNOT_BECOME_OBJECT`.
- **Counterexample**: `(null === v) || (undefined === v)` with `v = {}`: evaluates to `false`, whereas `__cannotBecomeObject(null)` evaluates to `true`.
- **Fix**: Changed `[xa]` to `[z]` in `rewrite(z)`.

### 7. `x != null` and `!(x == null)` falsely deriving truthiness of `x` (`src/utils/paths.js:367, 414`)
- **Unsound rule**: `pushPathCondition` on `x != null` and `pushInversePathCondition` on `x == null` unconditionally called `pushPathCondition(left)`, asserting that any non-nullish value is truthy.
- **Counterexample**: Any non-nullish falsy value (`0`, `-0`, `""`, `false`, `NaN`):
  - Audit on `P4-paths/null-check-then-property.js`: `push (o != null) ~> o` with `o = false`.
  - Audit on `fuzz/conditional-null-check-negation.js`: `!(a == null ? 0 : a)` simplified `(a == null ? 0 : a)` in condition context to `!(a == null)` (so `!(...)` became `a == null`), which for `a = ""` returns `false` instead of `true`.
  - `fuzz/path-implies-both-true-visitor.js`: inside `if (!a) { ... if (a == null) throw ...; }`, pushing `!(a == null)` added `a` alongside `!a`, causing both `Path.implies` and `Path.impliesNot` to return `true` and crashing `ResidualHeapVisitor`.
- **Fix**: Extracted `pushNullishCheck` + `onlyNullOrUndefinedCanBeFalsy(left)`, pushing `left` as truthy **only** when `null` and `undefined` are proven to be the sole falsy values `left` can take (e.g. `!left.mightBeFalse()` or `abstractConcreteUnion(nonFalsy, null, undefined)`).

### 8. `!(x != null)` deriving `x === null` instead of `x === null || x === undefined` (`src/utils/paths.js:413-419`)
- **Unsound rule**: `pushInversePathCondition` on `left != null` set `op = "==="` and executed `if (leftEqNull.mightNotBeFalse()) pushPathCondition(leftEqNull)` followed by `leftEqUndefined`, pushing `left === null` **conjunctively** onto the path (which then caused `left === undefined` to simplify to `false`), erasing the `undefined` case completely!
- **Counterexample**: Audit on `SimpleObject3.js` and `P4-paths/null-check-then-property.js`: `push !(o != null) ~> (o === null)` with `o = undefined`.
- **Fix**: Routed `pushInversePathCondition` for `!=` / `==` against `null`/`undefined` through `pushNullishCheck`, which pushes the disjunction `(left === null) || (left === undefined)`.

### 9. No-op comparison typo and `-0` equality in conditional `===` path push (`src/utils/paths.js:347-354`)
- **Unsound rule**: `[left, right] === [right, left];` was a dead equality expression rather than destructuring assignment `[left, right] = [right, left];`, and `right.equals(x)` used `Object.is` (`(+0).equals(-0) === false`) instead of JS `===`.
- **Counterexample**: `0 === (c ? -0 : 1)` has `0 === -0` (`true`) and `0 === 1` (`false`), so `c` must hold; conversely `0 === (c ? -0 : +0)` holds regardless of `c` and must **not** push `!c` (`c = true` is a counterexample if `(+0).equals(-0) === false` caused it to treat the `then` arm as unequal and `else` arm as equal!).
- **Fix**: Fixed assignment `[left, right] = [right, left]` and compared concrete numbers with `a.value === b.value` (`concreteStrictEqual`).

### 10. `(0 !== x) => x` implication rule (`src/values/AbstractValue.js:284-288`)
- **Unsound rule**: `AbstractValue.implies` contained:
  ```js
  // (0 !== x) => x since undefined, null, false, 0, NaN and "" are excluded by the !== and all other values are thruthy
  ```
  Strict `0 !== x` excludes only `0` and `-0`; `0 !== false`, `0 !== ""`, `0 !== null`, `0 !== undefined`, and `0 !== NaN` are all `true`!
- **Counterexample**: `x = false` (or `""`, `null`, `undefined`, `NaN`): `0 !== false` is `true`, while `Boolean(false)` is `false` (`zeroNotStrictEq` in `SmtSoundnessTruthinessAndEquality.js`).
- **Fix**: Deleted the rule.

### 11. Loose `x == null` implying strict `x === null` (`src/values/AbstractValue.js:298, 314`)
- **Unsound rule**: In `AbstractValue.implies`, when `this` was `x == null` and `val` was `x === null`, the `if (val.kind === "==")` check fell into an unguarded `else` branch that assumed `this.kind === "==="` and concluded `(x == null) => (x === null)`.
- **Counterexample**: `x = undefined`: `undefined == null` is `true`, while `undefined === null` is `false` (`notStrictNullVsLooseNull` in `SmtSoundnessTruthinessAndEquality.js`).
- **Fix**: Changed `else` to `else if (this.kind === "===")`.

### 12. `(x === +0)` implying `!(x === -0)` (`src/values/AbstractValue.js:397-402`)
- **Unsound rule**: `AbstractValue.impliesNot` deduced `(x === y1) => !(x === y2)` whenever `!y1.equals(y2)`, which is `true` for `y1 = +0, y2 = -0` because `NumberValue.equals` uses `Object.is`.
- **Counterexample**: `x = 0`: `0 === +0` and `0 === -0` are both `true`.
- **Fix**: Used `sameConcrete` (`a.value === b.value` on `NumberValue`).

### 13. Cross-branch contamination of `PathConditions` caches (`src/utils/paths.js:98, 156, 240-260`, `src/values/AbstractValue.js:221-380`)
- **Unsound rule**:
  1. `AbstractValue.implies` for `||` and `&&` consulted `this.$Realm.pathConditions.impliesNot(...)` (the leaf path) even when called while walking an ancestor `_baseConditions` node; a `true` result was then cached on the **ancestor** `PathConditions` via `cacheImplicationSuccess`, polluting sibling branches that shared that ancestor!
  2. `refineBaseConditons` mutated `_impliedConditions` / `_impliedNegatives` while `_baseConditions` was temporarily detached without restoring those caches in `finally`.
- **Counterexample**: `crossBranchDisjunctionCache(false, false, false, true, null)` (`c = false, p = null`): inside `if (p || (!p && !c))`, speculative evaluation of `if (c)` pushed `c`, proved `p` from `p || (!p && !c)` + `c`, and cached `p` on the outer path; after `if (c)` joined, `p ? "t2" : "f2"` evaluated to `"t2"` for `p = null`!
- **Fix**: Threaded explicit `context?: PathConditions` through `Value.implies`/`impliesNot` and `AbstractValue.implies`/`impliesNot`, and saved/restored `_impliedConditions` and `_impliedNegatives` around `refineBaseConditons`.

### Additional soundness & P4 fixes uncovered alongside the solver

- **`AbstractRelationalComparison` (`src/methods/abstract.js:142-144`)**: When `AbstractValue.createFromBinaryOp` simplified an abstract `<=` or `>=` comparison all the way to a concrete `BooleanValue`, `BinaryExpression.js` (following ECMA-262 12.10.3 where `<` is negated for `<=`/`>=` when `r` is concrete) negated the already-final boolean a second time. Negating `BooleanValue` inside `AbstractRelationalComparison` for `<=`/`>=` restores the contract expected by `BinaryExpression.js`.
- **`UpdateExpression` `x++` / `++x` on non-numbers (`src/evaluators/UpdateExpression.js:39-80`)**: `a1++` on an untyped abstract `a1` previously emitted `a1 + 1` and returned uncoerced `a1`, turning `main("0")` into `"01"` / `"0"` instead of `1` / `0` (`fuzz/update-expression-string.js`). Fixed by coercing via unary `+oldExpr` whenever `oldExpr` is not already `NumberValue`-compatible.
- **`InfeasiblePathError` vs `invariant(false)` (`src/utils/paths.js:315, 341, 435, 479`)**: Replaced `invariant(false, "assuming that false equals true is asking for trouble")` with `throw new InfeasiblePathError()` so infeasible sub-branches discovered during simplification or loop widening are cleanly pruned (`fuzz/loop-null-check-path-condition.js`, #2361).
- **`Array.prototype.join` on abstract elements (`src/intrinsics/ecma262/ArrayPrototype.js:863-912`)**: Emit `"" + el` / `+` concatenation for pure non-nullish non-symbol abstract elements instead of failing in `ToStringPartial` (superseded on merge by `revive`'s `joinElementToString`).
- **Latent exponential blowup exposed by fixing rule #13 on Babel-lowered `for-of` loops (`#2053`, `#2477`)**: Previously, cross-branch cache pollution on Iteration 2 of `for (...; ; ) { if (_isArray) ... else ... }` unsoundly cached `!_isArray` on the outer loop path, pruning one branch of `if (_isArray)` for Iterations 3–7. With sound branch isolation keeping both branches live, `ForBodyEvaluation`'s 6-iteration speculative unroll multiplied `savedCompletion` across 6 `switch` returns (`20 -> 38 -> 88 -> 258 -> 1,916 -> ~120,000` nodes before bailing out with `PP0035` to `residualizeLoop`), `createJoinConditionForSelectedCompletions` recursively recomputed `composedWith` twice per level without memoization, and `negate` had no depth bound. Fixed by memoizing `createJoinConditionForSelectedCompletions` and reusing `jcw` (`src/values/AbstractValue.js`), bounding `negate` depth and recursive re-simplification (`src/utils/simplifier.js`), bailing out `ForBodyEvaluation` on un-incremented loops once `savedCompletion` exceeds 64 distinct `Completion` nodes (`src/evaluators/ForStatement.js`), and capping fallback Z3 queries per Realm (`MAX_REALM_FALLBACK_QUERIES = 400`).

---

## 4. Measured Overhead

Measured on the 4-CPU Linux test machine (Node v26.7.0, Z3 4.16):

| Run | Mode | Wall clock | User CPU | `solverMs` | Z3 `queries` | `cacheHits` (hit rate) | `sat` / `unsat` / `unknown` | `untranslatable` | `auditChecks` (failures) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `test-serializer --fast` (1,004 runs) | `off` | 27.6 s | 24.1 s | 0 ms | 0 | 0 (—) | 0 / 0 / 0 | 0 | 0 (—) |
| `test-serializer --fast` (1,004 runs) | `fallback` | 190.1 s | 30.1 s | 154.7 s | 13,526 | 59,811 (**81.6%**) | 12,266 / 401 / 859 | 2,675 | 0 (—) |
| `test-serializer --fast` (1,004 runs) | `audit` | 224.2 s | 35.3 s | 189.4 s | 46,478 | 59,811 (**56.3%**) | 12,253 / 33,348 / 877 | 3,770 | **34,047 (0)** |
| `test-serializer` full (3,386 runs) | `fallback` | 460.1 s | 270.4 s | 150.6 s | 13,526 | 1,074,625 (**98.8%**) | 12,266 / 401 / 859 | 8,025 | 0 (—) |
| `hard-scoreboard.js` (138 tests, 3 jobs) | `fallback` | 104.7 s | — | — | — | — | — | — | 0 (—) |
| `hard-scoreboard.js` (138 tests, 3 jobs) | `audit` | 115.1 s | — | — | — | — | — | — | **0 failures** |

Key observations on the numbers:

- **Median vs tail query latency**: Simple linear/datatype queries complete in ~0.05–0.5 ms; across the 34,047 extra audit queries (`fallback` -> `audit` on `--fast`), 32,952 uncached Z3 calls added only **34.7 s** total (**1.05 ms/query** average). Most of the 150 s `solverMs` in `fallback` comes from the 859 complex string/union `sat`/`unknown` queries that run up to `DEFAULT_RLIMIT = 200000` (~150 ms each).
- **Caching eliminates repeat cost across permutations**: On the full 3,386-run `test-serializer` suite (multiple flag permutations + up to 4 fixed-point re-serializations per file), unique Z3 queries stay flat at **13,526** while `cacheHits` climbs to **1,074,625 (98.8% hit rate)**, adding ~2.5 min of Z3 time over the ~4.5 min JS baseline.

---

## 5. What Remains Unsolved & Why

1. **IEEE-754 rounding and overflow on symbolic arithmetic**:
   ```js
   // x = 9007199254740992 (2^53): in JS, x + 1 === x is true!
   if (x > 0 && x + 1 === x) return "ulp-loss";
   ```
   Because `nadd` uses exact `Real` addition (`(Fin (+ (fv a) (fv b)))`), Z3 believes `x + 1 > x` for every finite `x` and will treat `x + 1 === x` (for finite `x`) or `(x + y) === Infinity` (for finite `x, y` near `Number.MAX_VALUE`) as unsatisfiable. Switching `N` to `(FloatingPoint 11 53)` makes `===`/`<`/`+` bit-exact, at a 100–1000x solver slowdown; a targeted two-tier query (use FP64 only when a query mixes arithmetic with equality or huge magnitudes) is a natural future refinement if needed.
2. **Bitwise and non-linear numeric reasoning**:
   `&`, `|`, `^`, `<<`, `>>`, `>>>`, `~`, `%`, `/`, and symbolic `a * b` are modelled as uninterpreted `(numop op a b)` for congruence only. Bounds like `(x & 3) < 4` are handled cheaply by Track 1C's `IntervalDomain`, not by Z3's `Real` sort (mixing 32-bit `(_ BitVec 32)` `bv2int`/`int2bv` conversions into every query causes severe Z3 slowdowns).
3. **Symbolic `Number <-> String` conversions and string methods**:
   `strnum` and `numstr` are grounded only on literals present in the query, so facts like `typeof x === "number" && x >= 0 && x < 10 => String(x).length === 1` or `RegExp`/`slice`/`indexOf` constraints remain opaque to SMT.
4. **Heap and object-property relationships**:
   Path conditions speak about pure `AbstractValue` DAGs (`args` and pure temporal descriptors). Mutated heap properties, prototype chains, and aliasing live in Prepack's heap snapshots rather than `realm.pathConditions`, so Z3 only sees property reads as opaque `ABSTRACT_PROPERTY` leaves (deduplicated when pure on the same object/key).
5. **Code-size bloat on `fuzz/path-implies-both-true-visitor.js` (BLOAT, 2.51x > 2x)**:
   The soundness crash is fixed and runtime output matches Node on all inputs, but leaking `o` to an unknown callback `f(o)` inside a conditional branch emits Prepack's leaked-object/model-invariant boilerplate (941 B vs 375 B input), which belongs to Track P6/P8's size and leak representation work.
