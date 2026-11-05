"use strict";

// The real-world benchmark section of Part 2, rendered from data/bench.json.
module.exports = (c, bench) => {
  if (!bench) return `<p><em>Benchmark data not collected yet (run site/scripts/summarize-bench.js).</em></p>`;
  const { esc } = c;
  const x = v => (v == null ? "–" : v.toFixed(2) + "×");
  const ms = v => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0));
  const rows = bench.workloads
    .map(w => {
      const p = w.perf;
      const prof = `${w.okProfiles.length}/6`;
      if (!p) {
        return `<tr class="failrow"><th scope="row">${esc(w.id)}</th><td class="num">${w.kb.toLocaleString("en-US")}</td><td class="num">${prof}</td><td colspan="4" class="blk">Stops: <code>${esc(
          w.blocker || w.status
        )}</code></td></tr>`;
      }
      const cold = p.coldOrigMs >= 5 ? `${ms(p.coldOrigMs)} → ${ms(p.coldMs)} ms <strong>${x(p.coldSpeedup)}</strong>` : `<span class="muted">under 5 ms</span>`;
      return `<tr><th scope="row">${esc(w.id)}</th><td class="num">${w.kb.toLocaleString("en-US")}</td><td class="num">${prof}</td><td class="num">${x(
        p.gzipRatio
      )}</td><td class="num">${ms(p.codeCacheOrigMs)} → ${ms(p.codeCacheMs)} ms <strong>${x(p.codeCacheSpeedup)}</strong></td><td class="num">${x(
        p.execSpeedup
      )}</td><td class="num">${cold}</td></tr>`;
    })
    .join("");
  return `
<p>The benchmark corpus has 22 real libraries and app bundles, from 3.6 KB to 8.9 MB, each with a smoke test whose
output digest must match the original’s in a fresh <code>node</code> process and in a <code>vm</code> context. Each is
compiled under six option profiles (default, browser, seeded random, old JavaScriptCore, Node/React, lazy objects):
132 compilations. Results on the revived build:</p>

<div class="stat-row w">
  <div class="stat"><span class="stat-num">${bench.runs.WRONG || 0}</span><span class="stat-label">wrong outputs in ${
    (bench.runs.OK || 0) + (bench.runs.FAIL || 0) + (bench.runs.WRONG || 0)
  } compilations</span></div>
  <div class="stat"><span class="stat-num">${bench.summary.bestOk}</span><span class="stat-label">of 22 compile and match in at least one profile (${bench.summary.defaultOk} with defaults)</span></div>
  <div class="stat"><span class="stat-num">${bench.summary.fail}</span><span class="stat-label">stop with a clean diagnostic</span></div>
</div>

<p class="table-caption w">Revived Prepack on real code, browser profile. “Code cache” is load plus smoke test in a <code>vm</code>
context with V8’s code cache, the setting Prepack was designed for; “exec only” excludes compilation entirely; “cold”
is a fresh <code>node</code> process minus Node’s own ${ms(bench.coldBaselineMs)} ms startup, shown only where the
original takes at least 5 ms. Medians of 30 runs (15 for inputs over 750 KB) on a shared 4-core machine.</p>
<div class="table-wrap w"><table class="bench">
<thead><tr><th scope="col">Workload</th><th scope="col">KB</th><th scope="col">Profiles OK</th><th scope="col">gzip size vs original</th><th scope="col">Code cache</th><th scope="col">Exec only</th><th scope="col">Cold <code>node</code></th></tr></thead>
<tbody>${rows}</tbody></table></div>

<p>Two things stand out. Where initialization is real work, skipping it pays: moment registers well over a hundred locales at
load and starts 4.3× faster from the code cache, handlebars and the YAML router app about 3×. Where a library mostly defines
functions, there is little to skip and the result is a wash (lodash, marked). Size is now close to the original for
most inputs; the exceptions are deliberate trades the cost model made, such as <code>crc-32</code>, whose 4,352
precomputed CRC constants are 44 KB gzipped against 0.8 KB of source in exchange for skipping the computation. The four
failures stop where open-world environment values reach loops Prepack can’t summarize yet (for @babel/standalone, a
<code>localStorage</code> read; with <code>localStorage</code>, <code>navigator</code> and <code>document</code> assumed absent it compiles, in about 279 seconds).</p>
`;
};
