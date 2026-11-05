# Track R-bench: Real-World Benchmark & Triage Harness

## What We Built

1. **15-Workload Real-World Corpus (`bench/libs/`, `bench/setup.js`, `bench/package.json`)**:
   - 10 standalone npm libraries (`lodash@4.18.1`, `underscore@1.13.8`, `ramda@0.32.0`, `immutable@4.3.9`, `moment@2.31.0` with 135+ locales, `chroma-js@2.4.2`, `acorn@8.19.0`, `crc-32@1.2.2`, `marked@18.1.3`, `d3-scale@4.0.3` + `d3-array@3.2.5` + `internmap@2.0.3`) and 5 init-heavy app workloads (`redux@5.0.1` store+middleware init, `handlebars@4.7.10` compile-at-init app, `preact@10.29.0` + `preact-render-to-string@6.6.7` SSR app, `react@18.3.1` + `react-dom@18.3.1` SSR app, and a `js-yaml@4.3.2` + `mustache@4.2.0` + URL router gateway app).
   - Exact versions, licenses, byte sizes, SHA-256 hashes, and expected smoke-test digests are recorded in `bench/libs/manifest.json`.
   - Every workload has a deterministic API smoke test verified in **both** fresh `node` processes (`TZ=UTC LANG=C`) and fresh `vm` contexts.

2. **Isolated Multi-Option Prepack Runner & Performance Harness (`bench/run.js`, `bench/prepack-worker.js`, `bench/perf.js`)**:
   - Evaluates 6 option profiles per workload (`default`, `browser-opt` with `--delayInitializations --inlineExpressions`, `browser-seed` with `--mathRandomSeed 0`, `jsc`, `node-react`, and `lazy-objects` with a `Proxy` hydration harness) in forked workers with per-workload timeouts (default 5 min) and 4 GB V8 heap caps.
   - Classifies each run into `OK`, `WRONG` (silent miscompile — exit 0 with runtime throw or digest mismatch), `FAIL` (recording `PPxxxx` code, source line/column excerpt, and internal stack frame), or `TIMEOUT`.
   - For all `OK` workloads, benchmarks Original vs Prepacked over `N=30` interleaved runs (`warmup=5`):
     - Cold `node` startup with interleaved `node -e 0` baseline subtraction;
     - V8 code-cached execution (`vm.Script` + `createCachedData()`);
     - Pure execution time in a fresh `vm` context (excluding parse/compile);
     - Node V8 startup snapshots (`node --snapshot-blob ... --build-snapshot`) as an engine-level reference;
     - Sizes: raw, Terser-minified, gzip, and brotli.
   -Note on methodology: all timing loops execute *before* loading Terser in-process, and interleave `node -e 0` per workload, eliminating Linux `fork()` PTE-copy distortion from parent heap growth.

3. **Triage & Hard-Corpus Reproducers (`bench/TRIAGE.md`, `test/serializer/hard/real-world-libs/*.js`)**:
   - Added 8 minimal, deterministic reproducers under `test/serializer/hard/real-world-libs/` covering every `WRONG` and `FAIL` uncovered in the real-world corpus (plus ES2015-lowered secondary blockers in `marked` and `d3-scale`).

## Key Findings

- **Coverage**: **9 / 15** pass out-of-the-box (`default`), **11 / 15** pass with the best option profile (`redux` with `--mathRandomSeed 0`, `underscore` with `--compatibility jsc-600-1-4-17`), **1 `WRONG`** (`handlebars-app`), **3 `FAIL`** (`crc-32`, `marked`, `d3-scale`), **0 `TIMEOUT`**.
- **Critical `WRONG` bug**: `handlebars@4.7.10` runs Mathias Bynens's `globalThis` polyfill (`Object.prototype.__defineGetter__('__magic__', ...)`) because `globalThis` is absent from Prepack's globals and `__defineGetter__` is absent from `Object.prototype`. Prepack emits only `Warning PP0023` and exits `0` with a bundle that unconditionally throws `TypeError: not an object`.
- **Where Prepack wins big**: Init-heavy workloads with V8 bytecode caching (`cachedData`): **`moment` (135 locales) is 3.49x faster** (`14.06 ms -> 4.03 ms`), **`yaml-router-app` is 2.61x faster** (`1.50 ms -> 0.57 ms`, and **1.56x faster** even in uncached cold `node`!), **`redux` is 1.42x faster** and **11% smaller** in gzip, **`lodash` is 1.41x faster**, **`ramda` is 1.32x faster**, and **`preact-ssr-app` is 1.24x faster**.
- **Where Prepack loses**: Without parse caching, code-size expansion on factory/installer-heavy libraries (`lodash` 2.07x gzip, `ramda` 1.62x gzip) makes cold text-parsed `node` startup slower (`lodash` 0.74x), and heavy descriptor/closure materialization slows `react-ssr-app` (0.73x) and `acorn` (0.86x) — concrete motivation for Track 2C (`P8-size` cost model).
