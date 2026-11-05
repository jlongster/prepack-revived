# Track bench2: Large Real-World Benchmark Extension

## Summary of Changes

1. **7 Large Real-World Workloads (`bench/libs/specs.js`, `bench/package.json`, `bench/setup.js`)**:
   - Added `moment-timezone` (`913.3 KB`), `prettier` (`1,065.6 KB`), `highlight-js` (`1,834.5 KB`), `three` (`1,914.4 KB`), `mathjs` (`2,117.9 KB`), `babel-standalone` (`5,248.9 KB`), and `typescript` (`8,899.1 KB`), expanding the corpus from 15 workloads (`2.70 MB`) to **22 workloads (`24.18 MB`)**.
   - Updated `bench/setup.js` (`needsInstall`) to check all declared `bench/package.json` dependencies rather than only `lodash`, and `bench/run.js` (`ensureCorpusReady`) to auto-rebuild if new specs or dist bundles are missing.

2. **Harness Scaling & Instrumentation (`bench/run.js`, `bench/prepack-worker.js`, `bench/perf.js`, `bench/harness.js`)**:
   - **Timeouts**: `900,000 ms` (15 min) default worker timeout for `>= 750 KB` workloads, forwarded via `options.timeout` to both Prepack's `Realm` and Hybrid's capture worker; `180s` `--build-snapshot` timeout; `120s` cold-node & VM smoke timeout; `300s` isolated child-process Terser timeout.
   - **Memory**: `--max-old-space-size=16384` (propagated via `NODE_OPTIONS` to nested workers), memory-weighted worker scheduling (serializing `>= 3 MB` workloads on 15.6 GB RAM), and peak RSS tracking (`process.resourceUsage().maxRSS` + `/proc/<pid>/status` `VmHWM`).
   - **Adaptive Perf Runs**: Preserves `N=30, warmup=5` for all 15 `< 750 KB` workloads; adapts to `N=15, warmup=3` for `0.75–3 MB` and `N=12, warmup=3` for `>= 3 MB` (`N >= 10`).
   - **Original Baselines (`origPerf`)**: Captures cold `node`, V8 `cachedData`, VM exec-only, raw/Terser/gzip/brotli sizes, and Node `--build-snapshot` on all 22 workloads even when Prepack fails, while keeping `perf: null` on failing runs for full backward compatibility with `hybrid/bench-compare.js`.

3. **Results & Documentation (`bench/LARGE.md`, `bench/results/20261105T101547Z.json`, `bench/results/latest.md`)**:
   - On the 7 large workloads, Prepack (`revive`) achieves **1 `OK`** (`moment-timezone`), **1 `WRONG`** (`highlight-js`, silent `PP0023` miscompile in `deepFreeze`), and **5 `FAIL`** (`three` and `babel-standalone` on `$ArrayBufferData` inside residualized loops `PP0037`; `prettier`, `mathjs`, and `typescript` on ES2019/ES2020 parser syntax `PP1004`).
   - Verified `node bench/run.js --prepack /tmp/opencode/pp-wt/hybrid/hybrid/index.js` end-to-end on the new large workloads (including 8.9 MB `typescript`).
