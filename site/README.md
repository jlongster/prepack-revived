# Prepack, revived: the story site

A static, single-page longform article about the Prepack revival, built from plain HTML, CSS and JS
with a small Node build script. No framework and no CDN: fonts (Source Serif 4, IBM Plex Sans,
IBM Plex Mono; SIL OFL) are in `assets/fonts/`.

```sh
node site/build.js                       # -> site/dist/
rsync -a --delete site/dist/ ~/projects/website/artifacts/prepack-revived/   # publish
```

Published at https://jamesbox.exe.xyz/artifacts/prepack-revived/

## Data, and how to regenerate it

Every code panel and number comes from a real run; the build only reads `data/`.

| File | Produced by |
|---|---|
| `data/examples.json` | `node site/scripts/run-examples.js [ids…]`: runs each input in `examples/` (see `examples/manifest.js`) through Prepack 0.2.54, the revived `lib/prepack-cli.js` and the hybrid CLI, then runs the original and every output and records the probe results. Tool paths: `PP_ORIG`, `PP_REVIVED`, `PP_HYBRID`. |
| `data/scoreboard.json`, `data/react.json` | `node site/scripts/collect-data.js orig.json revived.json render.js`: two `scripts/hard-scoreboard.js --json` runs (0.2.54 and revived) and the react-ssr render cache produced by `react-bench/check.js --impl react-bench/impl/prepack.js`. |
| `data/bench.json` | `node site/scripts/summarize-bench.js correctness.json perf.json`: `bench/run.js --no-perf` (all profiles) and `bench/run.js --profiles browser-opt --no-snapshot --only …` (perf). |

Quotes live in `src/quotes.js`, each with the URL of the exact comment, issue, gist or source line.

## Checks

```sh
node site/scripts/check-links.js                                    # anchors + external links (GitHub comments via gh api)
NODE_PATH=…/node_modules node site/scripts/screenshot.js OUT [sel]  # headless Chromium (playwright-core), 1440 and 390 px
SCHEME=dark …                                                       # same, dark color scheme
```
