# Why Prepack was abandoned: research summary

Prepack is Facebook's JavaScript partial evaluator, 2015–2019. It was archived in February 2022. This page summarizes the research done before reviving it. Full citations are in the agent reports this summary was distilled from; the key sources are linked inline.

## Timeline

- **2016:** Nikolai Tillmann joins Facebook to work on React Native startup time.
- **May 2017:** public launch at prepack.io. The [HN thread](https://news.ycombinator.com/item?id=14257744) reached 836 points.
- **2018:**
  - React compiler experiments built on Prepack (Dominic Gannaway).
  - Dan Abramov's renderer experiment ([react#12206](https://github.com/facebook/react/issues/12206)).
  - Last release: v0.2.54, October 2018.
- **December 2018:** the README says work is "temporarily set down".
- **June 2019:** React Native removes a Prepack comment: "We aren't shipping Prepack anytime soon."
- **February 2020:** Herman Venter's post-mortem in [#2639 "Is prepack dead?"](https://github.com/facebookarchive/prepack/issues/2639).
- **February 2022:** repository archived.

## Stated reasons for stopping

- **Herman Venter, Prepack lead** ([#2639](https://github.com/facebookarchive/prepack/issues/2639)):
  - "no one currently at Facebook seems to have a scenario in mind where they believe that Prepack can be of use."
  - "you need the whole program along with an accurate model of the environment it will run in. Even then, you can only really run it on global code."
  - It is built on Babel and needs ES5 lowering, so updating it to modern JavaScript "will be a lot of work".
  - "If I had to do it all over, I would stick to my original plan and use Flow as the basis."
- **Sebastian Markbåge** ([gist](https://gist.github.com/sebmarkbage/a5ef436427437a98408672108df01919)): output size growth was "ultimately the reason we abandoned that particular approach."
- **Dan Abramov** ([HN](https://news.ycombinator.com/item?id=25499545)): "One compiler bailout, and the difference in the bundle is huge." This shaped the design of Server Components and the deliberately narrow React Compiler: per-file, memoization only, startup-neutral.

## Hard technical problems found in the code and issue tracker

| # | Problem | Evidence |
|---|---|---|
| P1 | Loops with unknown trip counts: only unrolled, plus one widening attempt | #1174, #1722, #2396, #2055, the "6 iterations" limit, PP0035/PP0037 |
| P2 | Recursion under unknown conditions: summarization disabled | `call.js` TODO #1586, #543 (1 line became 1,065 lines) |
| P3 | Joins of `return`/`throw`/`break` across branches; try/catch | Fuzzer bugs #2354 and #2355 (silently wrong output), #2363, #2561, PP0021 |
| P4 | Hand-written path-condition reasoning with arbitrary caps | `simplifier.js` / `paths.js`, #2327, #2361, PP0029 |
| P5 | Numeric facts lost, e.g. a conditional `push` makes `length` unknown | #1066 |
| P6 | Objects escaping to unknown code (havoc), aliasing, built-ins treated as leaking | #2319, #2179, #1750 |
| P7 | Environment modeling: DOM, React Native, timers, timezone | #24 (76 reactions), 3,000 lines of hand-written mocks, closed-world globals |
| P8 | Output size explosion | #543 (121 reactions), #2140–#2143 |

Size of the code base: 81k lines. About 35k of those re-implement the ECMAScript spec, while the abstract domains are tiny. There were 192 open issues at archival.

## Hands-on experiments with published 0.2.54 on Node 26

- Pure constant code folds well: a fib table becomes a literal array.
- A loop whose bound comes from `Date.now()` fails with FatalError PP0001.
- An unknown global config was silently compiled into code that always throws.
- **A Promise in init code is miscompiled:** the callback is dropped, and the output contains a fake Promise that throws when used.
- **lodash:** the output works, but is 3× larger minified, 2× larger gzipped, and **slower** to load than the original on modern V8.
- React + ReactDOM fail on `document` (PP0012).
- A Node startup snapshot of lodash removes about 58% of the load overhead. The engine-level version of Prepack's idea is what survived.

## Where the idea lives on

- **Engine heap snapshots:** V8 and Node startup snapshots, Wizer, ComponentizeJS/StarlingMonkey.
- **Ahead-of-time bytecode:** Hermes, and Static Hermes with sound types.
- **Narrow, rule-based compilers:** React Compiler, Bun macros.
