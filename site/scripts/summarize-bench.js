// Summarizes two bench/run.js result files into site/data/bench.json:
//   correctness: `node bench/run.js --no-perf` (all workloads, all 6 option profiles)
//   perf:        `node bench/run.js --profiles browser-opt --no-snapshot --only <the OK workloads>`
//
//   node site/scripts/summarize-bench.js correctness.json perf.json
"use strict";
const fs = require("fs");
const path = require("path");

const [corrFile, perfFile] = process.argv.slice(2);
const corr = JSON.parse(fs.readFileSync(corrFile, "utf8"));
const perf = JSON.parse(fs.readFileSync(perfFile, "utf8"));

const runs = {};
for (const l of corr.libraries) for (const p of l.profiles) runs[p.status] = (runs[p.status] || 0) + 1;

const perfById = Object.fromEntries(perf.libraries.map(l => [l.id, l]));
const workloads = corr.libraries.map(l => {
  const p = perfById[l.id] && perfById[l.id].perf;
  const okProfiles = l.profiles.filter(x => x.status === "OK").map(x => x.profile);
  return {
    id: l.id,
    kb: +(l.bytes / 1024).toFixed(1),
    tier: l.tier,
    defaultStatus: l.defaultStatus,
    status: l.status,
    okProfiles,
    blocker: l.status !== "OK" && l.primaryBlocker ? `${l.primaryBlocker.errorCode}: ${l.primaryBlocker.message}`.trim() : null,
    compileMs: l.bestProfile ? l.bestProfile.compileMs : null,
    perf: p
      ? {
          n: p.runs,
          gzipOrigKB: +(p.sizes.orig.gzip / 1024).toFixed(1),
          gzipKB: +(p.sizes.prepacked.gzip / 1024).toFixed(1),
          gzipRatio: p.sizes.ratios.gzip,
          terserRatio: p.sizes.ratios.terser,
          coldOrigMs: p.coldProcess.orig.net.median,
          coldMs: p.coldProcess.prepacked.net.median,
          coldSpeedup: p.coldProcess.speedupNet,
          codeCacheOrigMs: p.vmCodeCache.orig.median,
          codeCacheMs: p.vmCodeCache.prepacked.median,
          codeCacheSpeedup: p.vmCodeCache.speedup,
          execSpeedup: p.vmExecOnly.speedup,
        }
      : null,
  };
});

const out = {
  date: corr.timestamp,
  node: corr.environment && corr.environment.node,
  coldBaselineMs: perf.nodeZeroBaseline && perf.nodeZeroBaseline.median,
  summary: corr.summary,
  runs,
  workloads,
};
fs.writeFileSync(path.join(__dirname, "../data/bench.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out.summary, out.runs);
