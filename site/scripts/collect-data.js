// Collects the measured data the page shows, besides the examples:
//  - data/scoreboard.json: per-test status of the hard-case corpus for Prepack 0.2.54 and the
//    revived build, from two `scripts/hard-scoreboard.js --json` runs.
//  - data/react.json: one component of the react-bench app with the code both specializers
//    generated for it.
//
//   node site/scripts/collect-data.js orig.json revived.json /path/to/prepack-render-cache.js
"use strict";
const fs = require("fs");
const path = require("path");

const SITE = path.resolve(__dirname, "..");
const [origFile, revivedFile, prepackRender] = process.argv.slice(2);
const BENCH = process.env.REACT_BENCH || "/tmp/opencode/pp-wt/react-bench/react-bench";
const HYBRID_TEMPLATE =
  process.env.REACT_HYBRID_TEMPLATE || "/tmp/opencode/pp-wt/react-hybrid/hybrid/react/results/generated-template.js";

const slim = r => ({
  prepack: path.basename(path.dirname(path.dirname(r.prepack))) + "/" + r.version,
  node: r.node,
  date: r.date,
  summary: r.summary,
  results: r.results.map(t => ({ test: t.test, problem: t.problem, status: t.status, detail: (t.detail || "").slice(0, 160) })),
});
const orig = slim(JSON.parse(fs.readFileSync(origFile, "utf8")));
const revived = slim(JSON.parse(fs.readFileSync(revivedFile, "utf8")));
fs.writeFileSync(path.join(SITE, "data/scoreboard.json"), JSON.stringify({ orig, revived }, null, 1) + "\n");

const app = fs.readFileSync(path.join(BENCH, "app/app.jsx"), "utf8");
const component = app.match(/^function StockBadge[\s\S]*?^}/m)[0];
const template = fs.readFileSync(HYBRID_TEMPLATE, "utf8").match(/^function \$T28\([\s\S]*?^}/m)[0];
const rendered = fs.readFileSync(prepackRender, "utf8");
// The spotlight instance of StockBadge (no ship date) is one self-contained conditional.
const start = rendered.indexOf('(_$5E <= 0 ? "<span class=\\"ns-stock ns-stock-out');
const end = rendered.indexOf('In stock</span>")', start) + 'In stock</span>")'.length;
if (start < 0 || end < start) throw new Error("StockBadge fragment not found in Prepack output");
fs.writeFileSync(
  path.join(SITE, "data/react.json"),
  JSON.stringify({ component, hybridTemplate: template, prepackFragment: rendered.slice(start, end) }, null, 1) + "\n"
);
console.log("scoreboard:", orig.summary, revived.summary);
