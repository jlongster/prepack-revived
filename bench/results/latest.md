# Prepack Real-World Benchmark & Triage Report

- **Generated**: `2026-11-05T06:02:50.205Z`
- **Prepack**: `/tmp/opencode/pp-wt/bench/lib/prepack-node.js` (version `0.2.55-alpha.0`)
- **Environment**: Node `v26.7.0` on `linux/x64` (4 CPUs, 15.6 GB RAM)
- **Parameters**: `runs=30`, `warmup=5`, `timeout=300000ms`
- **`node -e 0` Cold Process Baseline**: median **53.81 ms** (p90 76.87 ms)

## Summary

| Metric | Count | Notes |
|---|---:|---|
| **Total workloads** | **15** | 10 libraries + 5 init-heavy app workloads |
| **OK (default options)** | **9** | Digest-identical in fresh `node` and `vm` with zero flags |
| **OK (best option profile)** | **11** | Includes libraries unlocked by `--compatibility` or `--mathRandomSeed` |
| **WRONG (silent miscompile)** | **1** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |
| **FAIL (Prepack error)** | **3** | Clean diagnostic (`PPxxxx`) or internal serializer error |
| **TIMEOUT** | **0** | Exceeded 300s per-lib cap |

## 1. Per-Library Status & Option Sweep

| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile | Top / Default Blocker |
|---|---|---|---:|---|---|---|---:|---|
| **`lodash`** | lodash@4.18.1 (MIT) | lib | 533.1 KB | **OK** | **OK** | `default` | 10465 ms | — |
| **`underscore`** | underscore@1.13.8 (MIT) | lib | 67.3 KB | **FAIL** | **OK** | `jsc` | 686 ms | *(default FAIL)* `PP0001` @ L139:35: This operation is not yet supported on document at childNodes |
| **`ramda`** | ramda@0.32.0 (MIT) | lib | 342.9 KB | **OK** | **OK** | `default` | 1804 ms | — |
| **`immutable`** | immutable@4.3.9 (MIT) | lib | 175.4 KB | **OK** | **OK** | `default` | 1538 ms | — |
| **`moment`** | moment@2.31.0 (MIT) | lib | 637.8 KB | **OK** | **OK** | `default` | 17007 ms | — |
| **`chroma-js`** | chroma-js@2.4.2 ((BSD-3-Clause AND Apache-2.0)) | lib | 109.2 KB | **OK** | **OK** | `default` | 1224 ms | — |
| **`acorn`** | acorn@8.19.0 (MIT) | lib | 240.9 KB | **OK** | **OK** | `default` | 2369 ms | — |
| **`crc-32`** | crc-32@1.2.2 (Apache-2.0) | lib | 3.6 KB | **FAIL** | **FAIL** | — | 415 ms | `PP0037` @ L57:2: failed to emit a residual loop: the loop calls an unknown or unsupported function in global cod |
| **`marked`** | marked@18.1.3 (MIT) | lib | 49.4 KB | **FAIL** | **FAIL** | — | 81 ms | `PP1004` @ L13:1309: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBindi |
| **`d3-scale`** | d3-scale@4.0.3 + d3-array@3.2.5 (+6) (ISC) | lib | 148.9 KB | **FAIL** | **FAIL** | — | 1633 ms | `UNDIAGNOSED_FATAL` (ResidualFunctions.spliceFunctions (lib/serializer/ResidualFunctions.js:602:23)): TODO: do not know how to deal with non-Identifier parameters |
| **`redux`** | redux@5.0.1 (MIT) | app | 18.1 KB | **FAIL** | **OK** | `browser-seed` | 632 ms | *(default FAIL)* `PP0031` @ L366:74: property access on unknown object |
| **`handlebars-app`** | handlebars@4.7.10 (MIT) | app | 211.9 KB | **WRONG** | **WRONG** | — | 1104 ms | `PP0023` @ L2665:53: VM runtime threw: TypeError: not an object |
| **`preact-ssr-app`** | preact@10.29.0 + preact-render-to-string@6.6.7 (MIT) | app | 22.0 KB | **OK** | **OK** | `default` | 1407 ms | — |
| **`react-ssr-app`** | react@18.3.1 + react-dom@18.3.1 (MIT) | app | 47.0 KB | **OK** | **OK** | `default` | 2448 ms | — |
| **`yaml-router-app`** | js-yaml@4.3.2 + mustache@4.2.0 (MIT) | app | 157.1 KB | **OK** | **OK** | `default` | 7233 ms | — |

### Option Profile Matrix

| Workload | `default` | `browser-opt` | `browser-seed` | `jsc` | `node-react` | `lazy-objects` |
|---|---|---|---|---|---|---|
| `lodash` | OK (872.3 KB) | OK (901.1 KB) | OK (901.1 KB) | FAIL (`PP0001`) | OK (901.1 KB) | OK (878.0 KB) |
| `underscore` | FAIL (`PP0001`) | FAIL (`PP0001`) | FAIL (`PP0001`) | OK (78.2 KB) | FAIL (`PP0001`) | FAIL (`PP0001`) |
| `ramda` | OK (260.0 KB) | OK (270.7 KB) | OK (270.7 KB) | OK (249.5 KB) | OK (270.7 KB) | OK (263.0 KB) |
| `immutable` | OK (144.6 KB) | OK (152.5 KB) | OK (152.3 KB) | OK (144.4 KB) | OK (152.3 KB) | OK (146.0 KB) |
| `moment` | OK (642.6 KB) | OK (753.2 KB) | OK (753.2 KB) | OK (642.1 KB) | OK (753.2 KB) | OK (834.2 KB) |
| `chroma-js` | OK (87.2 KB) | OK (94.9 KB) | OK (94.9 KB) | OK (85.1 KB) | OK (94.9 KB) | OK (91.7 KB) |
| `acorn` | OK (271.4 KB) | OK (280.6 KB) | OK (280.6 KB) | OK (271.1 KB) | OK (280.6 KB) | OK (276.0 KB) |
| `crc-32` | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) | FAIL (`PP0037`) |
| `marked` | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) | FAIL (`PP1004`) |
| `d3-scale` | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) | FAIL (`UNDIAGNOSED_FATAL`) |
| `redux` | FAIL (`PP0031`) | FAIL (`PP0031`) | OK (14.6 KB) | OK (14.0 KB) | OK (14.6 KB) | OK (15.0 KB) |
| `handlebars-app` | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) | WRONG (`PP0023`) |
| `preact-ssr-app` | OK (35.1 KB) | OK (37.4 KB) | OK (37.4 KB) | WRONG (`PP0023`) | WRONG (`PP0023`) | OK (36.0 KB) |
| `react-ssr-app` | OK (125.2 KB) | OK (151.9 KB) | OK (151.9 KB) | WRONG (`PP0023`) | OK (151.9 KB) | OK (131.1 KB) |
| `yaml-router-app` | OK (127.5 KB) | OK (136.5 KB) | OK (136.5 KB) | OK (127.2 KB) | OK (136.5 KB) | OK (137.5 KB) |

## 2. Runtime Performance (Original vs Prepacked vs V8 Snapshot)

All timings cover **library load + deterministic smoke-test API suite**, measured over `N=30` interleaved runs after `5` warmups. **Speedup > 1.00x means Prepacked is faster than Original.**

| Workload | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |
|---|---|---|---|---|---|---|---|
| **`lodash`** | 24.52 (49.65) -> 33.21 (73.90) ms | **0.74x** | 3.67 (5.27) -> 2.60 (8.99) ms | **1.41x** | 3.28 (18.74) -> 2.08 (6.30) ms | **1.58x** | 28.03 ms (7.2 MB) |
| **`underscore`** | 6.75 (28.44) -> 7.80 (24.24) ms | **0.87x** | 0.53 (2.61) -> 0.46 (2.67) ms | **1.16x** | 0.42 (4.20) -> 0.40 (1.56) ms | **1.06x** | 6.08 ms (6.2 MB) |
| **`ramda`** | 5.71 (19.67) -> 4.70 (24.91) ms | **1.21x** | 1.14 (1.52) -> 0.86 (1.62) ms | **1.32x** | 0.74 (3.74) -> 0.48 (0.60) ms | **1.55x** | 4.88 ms (6.7 MB) |
| **`immutable`** | 5.56 (31.41) -> 8.01 (31.30) ms | **0.69x** | 1.21 (8.22) -> 1.09 (9.18) ms | **1.11x** | 1.11 (1.25) -> 0.99 (1.19) ms | **1.12x** | 14.19 ms (6.4 MB) |
| **`moment`** | 29.26 (71.63) -> 33.03 (80.50) ms | **0.89x** | 14.06 (23.54) -> 4.03 (9.86) ms | **3.49x** | 13.26 (23.57) -> 3.92 (6.77) ms | **3.38x** | 11.04 ms (7.7 MB) |
| **`chroma-js`** | 5.94 (11.10) -> 5.67 (11.15) ms | **1.05x** | 0.66 (0.75) -> 0.62 (0.68) ms | **1.07x** | 0.65 (0.68) -> 0.60 (0.62) ms | **1.08x** | 7.89 ms (6.1 MB) |
| **`acorn`** | 10.85 (29.07) -> 10.54 (18.22) ms | **1.03x** | 1.48 (1.91) -> 1.71 (1.82) ms | **0.86x** | 1.43 (1.56) -> 1.65 (1.99) ms | **0.86x** | 10.30 ms (6.6 MB) |
| **`redux`** | 1.48 (4.27) -> 0.27 (2.28) ms | **5.45x** | 0.19 (0.22) -> 0.14 (0.18) ms | **1.42x** | 0.20 (0.31) -> 0.13 (0.19) ms | **1.57x** | 4.60 ms (6.0 MB) |
| **`preact-ssr-app`** | 1.20 (5.72) -> 0.00 (2.69) ms | **—** | 0.31 (0.35) -> 0.25 (0.28) ms | **1.24x** | 0.31 (0.33) -> 0.24 (0.26) ms | **1.28x** | 4.18 ms (6.0 MB) |
| **`react-ssr-app`** | 5.24 (13.05) -> 5.38 (12.76) ms | **0.98x** | 0.95 (0.98) -> 1.29 (1.35) ms | **0.73x** | 0.97 (1.05) -> 1.34 (1.89) ms | **0.72x** | 5.85 ms (6.2 MB) |
| **`yaml-router-app`** | 6.83 (13.86) -> 4.39 (6.41) ms | **1.56x** | 1.50 (1.67) -> 0.57 (0.65) ms | **2.61x** | 1.43 (1.49) -> 0.57 (0.64) ms | **2.51x** | 5.97 ms (6.4 MB) |

## 3. Code Size Comparison

`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original.

| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |
|---|---|---|---|---|
| **`lodash`** | 533.1 KB -> 872.3 KB (1.64x) | 69.0 KB -> 218.1 KB (3.16x) | 24.5 KB -> 50.7 KB (**2.07x**) | 23.6 KB -> 38.7 KB (**1.64x**) |
| **`underscore`** | 67.3 KB -> 78.2 KB (1.16x) | 18.9 KB -> 34.8 KB (1.84x) | 7.2 KB -> 8.0 KB (**1.11x**) | 7.0 KB -> 7.7 KB (**1.10x**) |
| **`ramda`** | 342.9 KB -> 260.0 KB (0.76x) | 52.6 KB -> 133.8 KB (2.54x) | 14.1 KB -> 22.9 KB (**1.62x**) | 13.6 KB -> 18.9 KB (**1.39x**) |
| **`immutable`** | 175.4 KB -> 144.6 KB (0.82x) | 64.9 KB -> 62.8 KB (0.97x) | 18.0 KB -> 17.9 KB (**1.00x**) | 17.3 KB -> 17.2 KB (**1.00x**) |
| **`moment`** | 637.8 KB -> 642.6 KB (1.01x) | 292.3 KB -> 352.3 KB (1.21x) | 74.3 KB -> 99.2 KB (**1.34x**) | 62.6 KB -> 82.9 KB (**1.32x**) |
| **`chroma-js`** | 109.2 KB -> 87.2 KB (0.80x) | 42.5 KB -> 42.2 KB (0.99x) | 15.4 KB -> 14.7 KB (**0.96x**) | 14.7 KB -> 14.2 KB (**0.96x**) |
| **`acorn`** | 240.9 KB -> 271.4 KB (1.13x) | 115.6 KB -> 164.8 KB (1.43x) | 33.9 KB -> 38.8 KB (**1.15x**) | 31.7 KB -> 33.8 KB (**1.07x**) |
| **`redux`** | 18.1 KB -> 14.6 KB (0.81x) | 8.8 KB -> 7.7 KB (0.87x) | 3.3 KB -> 3.0 KB (**0.89x**) | 3.2 KB -> 2.8 KB (**0.89x**) |
| **`preact-ssr-app`** | 22.0 KB -> 35.1 KB (1.60x) | 21.2 KB -> 22.0 KB (1.04x) | 8.6 KB -> 8.8 KB (**1.02x**) | 8.5 KB -> 8.6 KB (**1.01x**) |
| **`react-ssr-app`** | 47.0 KB -> 125.2 KB (2.66x) | 45.1 KB -> 79.4 KB (1.76x) | 15.2 KB -> 21.0 KB (**1.38x**) | 14.4 KB -> 18.5 KB (**1.29x**) |
| **`yaml-router-app`** | 157.1 KB -> 127.5 KB (0.81x) | 51.8 KB -> 59.4 KB (1.15x) | 17.2 KB -> 18.1 KB (**1.05x**) | 16.6 KB -> 17.4 KB (**1.05x**) |

## 4. Diagnostics & Blockers Summary

### `underscore` — default `FAIL`, overall `OK`
- **Code**: `PP0001`
- **Message**: This operation is not yet supported on document at childNodes
- **Location**: line 139, column 35
- **Excerpt**: `var nodelist = root.document && root.document.childNodes;`
- **Internal Prepack frame**: `PropertiesImplementation.OrdinaryGetOwnProperty (lib/methods/properties.js:1467:15)`
- **Workaround profile**: `jsc` (`--compatibility jsc-600-1-4-17 --mathRandomSeed 0`) -> **OK**

### `crc-32` — default `FAIL`, overall `FAIL`
- **Code**: `PP0037`
- **Message**: failed to emit a residual loop: the loop calls an unknown or unsupported function in global code (PP0002: might be an object with an unknown valueOf or toString or Symbol.toPrimitive method)
- **Location**: line 57, column 2
- **Excerpt**: `for(n = 1; n != 16; ++n) out[n - 1] = typeof Int32Array !== 'undefined' ? table.subarray(n...`
- **Internal Prepack frame**: `fail (lib/evaluators/residualLoop.js:387:9)`

### `marked` — default `FAIL`, overall `FAIL`
- **Code**: `PP1004`
- **Message**: Syntax error: This experimental syntax requires enabling the parser plugin: 'optionalCatchBinding' (13:1308)
- **Location**: line 13, column 1309
- **Excerpt**: `...)=>{try{return!!new RegExp("(?<=1)(?<!1)"+a)}catch{return!1}})(),T={codeRemoveIndent:/^(?: {0,3}\t| {1,4})/gm,outputLinkReplace:/\\([\[\]])/...`
- **Internal Prepack frame**: `LexicalEnvironment.concatenateAndParse (lib/environment.js:1003:21)`

### `d3-scale` — default `FAIL`, overall `FAIL`
- **Code**: `UNDIAGNOSED_FATAL`
- **Message**: TODO: do not know how to deal with non-Identifier parameters
- **Internal Prepack frame**: `ResidualFunctions.spliceFunctions (lib/serializer/ResidualFunctions.js:602:23)`

### `redux` — default `FAIL`, overall `OK`
- **Code**: `PP0031`
- **Message**: property access on unknown object
- **Location**: line 366, column 74
- **Excerpt**: `...=> Math.random().toString(36).substring(7).split("").join(".");`
- **Internal Prepack frame**: `AbstractObjectValue.$Get (lib/values/AbstractObjectValue.js:647:13)`
- **Workaround profile**: `browser-seed` (`--compatibility browser --mathRandomSeed 0 --delayInitializations --inlineExpressions`) -> **OK**

### `handlebars-app` — default `WRONG`, overall `WRONG`
- **Code**: `PP0023`
- **Message**: VM runtime threw: TypeError: not an object
- **Location**: line 2665, column 53
- **Excerpt**: `...Object.prototype.__defineGetter__('__magic__', function () {`

