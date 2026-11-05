# Prepack revive: baseline (Phase 0A)

Measured 2026-11-05 on branch `revive`, on top of upstream `5beedbe8` plus the tooling commits listed below.
Machine: Linux (Arch, kernel 6.12), 4 CPUs, 15 GB RAM, no swap. **Node v26.7.0**, yarn 1.22.22. All suites run on Node 26; no older Node was needed.

## Results

| Suite | Command | Result | Wall clock |
|---|---|---|---|
| install | `yarn install --ignore-engines` (`--frozen-lockfile` works too) | ok (optional `v8-profiler-node8` fails to compile on Node 26; it is optional and unused by the tests) | 13 s |
| build (babel) | `yarn build-prepack` | ok, 332 files | 4 s |
| build (webpack bundle) | `yarn build-bundle` | ok, `prepack.min.js` 2.1 MB | 19 s |
| **serializer** | `yarn test-serializer` | **3378 / 3378 passed (100%)**, 1002 test files × flag permutations | 2 min 54 s |
| serializer, fast | `yarn test-serializer --fast` | 1002 / 1002 | 16 s |
| **error handler** | `yarn test-error-handler` | **42 / 42** | 1.7 s |
| std-in | `yarn test-std-in` | pass (exit 0) | 3 s |
| sourcemaps | `yarn test-sourcemaps` | 1 / 1 | 0.9 s |
| lint | `yarn lint` | 0 problems (after a formatting-only commit) | 15 s |
| flow | `yarn flow check` (flow-bin 0.83.0) | **0 errors** | ~90 s cold |
| depcheck | `yarn depcheck` | pass (biggest import cycle: 56) | 90 s |
| test262 (full, not sampled) | `yarn test-test262` | **17585 / 17806 (98%)**: ES5 11943 / 12073, ES6 5642 / 5733, 13349 skipped, 0 timeouts. This meets the runner's built-in expected counts (11943, 5641). | 1 min 40 s |
| react (jest 23) | `yarn test-react` | 223 passed, 1 failed, 1 skipped; snapshots 896 / 900 | 29 s |
| hard corpus (0B) | `node scripts/hard-scoreboard.js --prepack lib/prepack-node.js` | 133 tests: 38 PASS, 63 CRASH, 16 WRONG, 16 BLOAT (0B owns this; numbers are from its WIP corpus at the time of the run) | 56 s |

There are no failing serializer tests. 5 test files carry `// skip this test for now` and are filtered out by the runner, as upstream did.

The only failure is in react/jest: `test/react/FunctionalComponents-test.js` (4 snapshots of one test). This is environmental, not a Prepack bug: the snapshot stores V8's old error wording, `"Cannot read property 'push' of undefined"`, and modern V8 says `"Cannot read properties of undefined (reading 'push')"`. I left it as is. Update the snapshot with `jest -u` if you want a fully green run.

Not run: `test-internal` and `test-internal-react`, which need Facebook-internal bundles that aren't in the repo, and the coverage targets.

test262 note: the `test/test262` submodule was filled from `https://codeload.github.com/tc39/test262/tar.gz/e9a5a7f918c0f9c4a9f1224d25a6d55147953225`, extracted into `test/test262` (the submodule has `ignore = all`, so git doesn't show it). To recreate it:
```
curl -sL https://codeload.github.com/tc39/test262/tar.gz/e9a5a7f918c0f9c4a9f1224d25a6d55147953225 | tar xz -C test/test262 --strip-components=1
```
Groups with failures: `language/statements/{function,for-of,class,class/super}` and `class/subclass/builtin-objects/GeneratorFunction`, plus the newer `Array.prototype.flat/flatMap` tests (these were known failures upstream). To run a subset: `node_modules/.bin/babel-node scripts/test262-runner.js built-ins/Array`.

## Tooling patches (and why)

1. **`package.json` `resolutions`**: `test262-stream` now points to `https://codeload.github.com/bocoup/test262-stream/tar.gz/5435de67…`, the same commit the lockfile pinned. `test262-integrator` depends on it over `git://github.com/...`, which this network can't reach. `yarn.lock` was regenerated accordingly. HTTPS to github.com itself works here, so `git config url."https://github.com/".insteadOf git://github.com/` would probably also work, but the resolution needs no machine-level config.
2. **`flow-bin@0.83.0` added to devDependencies**, matching `.flowconfig` `[version] ^0.83.0`. Upstream assumed a globally installed `flow`. The 0.83 Linux binary runs fine on current Arch.
3. **`build-bundle` runs with `NODE_OPTIONS=--openssl-legacy-provider`**. Webpack 4 hashes with md4, which OpenSSL 3 rejects (`ERR_OSSL_EVP_UNSUPPORTED`).
4. **`scripts/test-runner.js`**:
   - `actualPromise.catch(() => {})` right after the output program is started. The runner attaches its real `.catch` only later, inside a thunk. Since Node 15 a rejection in that gap (for example in `basic/Promise.js`) aborts the whole run with `ERR_UNHANDLED_REJECTION` / an uncaught ReferenceError. The real handler still runs, so results are unchanged. `--unhandled-rejections=warn` was not usable because `babel-node` doesn't forward that flag.
   - Tests under `test/serializer/hard/` (0B's corpus, most of which is expected to fail) are skipped unless `--filter` contains `hard`. This keeps `yarn test-serializer` usable as the no-regressions gate. Score the corpus with `scripts/hard-scoreboard.js`.
5. **Formatting-only commit in `src/`**: `eslint --fix` for 15 prettier 1.17 errors left by upstream's last commit ("Upgrade prettier to 1.17.0"). This is whitespace, plus one interface body getting a newline and `;` and one arrow function's parentheses moving. No semantic change.

## How to run

```
scripts/scoreboard.sh            # babel build + full test-serializer + test-error-handler + hard corpus (~4.5 min)
scripts/scoreboard.sh --fast     # same, with test-serializer --fast (~1.3 min)
scripts/scoreboard.sh --skip-build --no-hard --filter abstract/
yarn test-serializer --fast --filter <substr>          # targeted
yarn test-serializer-single <substr>                   # verbose: prints generated code
```
Logs are written to `$SCOREBOARD_LOGS` (default `/tmp/opencode/scoreboard-logs`). The exit code is non-zero if the serializer or error-handler suite failed. The hard corpus is informational and does not affect the exit code.

## Notes for later phases

- The suite is fast and deterministic: 3 min full, 16 s with `--fast`. Two complete full runs (plus several `--fast` runs) gave identical results (3378/3378); no flakes or timeouts seen.
- `test-serializer` is single-threaded (runs tests in sequence), peak RSS measured at ~560 MB. The package.json scripts give `prepack-cli` and `test-internal` `--max_old_space_size=16384`/`32768`, but the serializer suite needs nothing special.
- `test-serializer` runs each test with up to 5 flag permutations and up to 4 re-serialization iterations, so `--fast` (1 permutation, 1 iteration) can miss bugs that depend on the delay-init, inline-expressions or lazy-objects modes. Use the full run as the merge gate.
- `scripts/hard-scoreboard.js` writes `test/serializer/hard/results.json` on every run. Don't commit that churn by accident.
- The jest snapshot failure above will show up in any `yarn test` run until the snapshot is updated.
