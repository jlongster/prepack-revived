// Extracts the final freezedry benchmark tables from its RESULTS.md into site/data/freezedry-results.json.
//   node site/scripts/freezedry-results.js /path/to/RESULTS.md
"use strict";
const fs = require("fs");
const path = require("path");

const md = fs.readFileSync(process.argv[2] || "/tmp/opencode/pp-wt/hybrid/hybrid/RESULTS.md", "utf8");

function table(heading) {
  const start = md.indexOf(heading);
  if (start < 0) throw new Error("missing section " + heading);
  const lines = md.slice(start).split("\n");
  const first = lines.findIndex(l => l.startsWith("|"));
  const rows = [];
  for (let i = first + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    rows.push(lines[i].split("|").slice(1, -1).map(s => s.trim().replace(/`/g, "").replace(/\*\*/g, "")));
  }
  return rows;
}

const num = s => {
  const m = String(s).match(/([\d.]+)\s*(KB|MB)?/);
  if (!m) return null;
  return m[2] === "MB" ? +m[1] * 1024 : +m[1];
};
const ratio = s => {
  const m = String(s).match(/\(([\d.]+)x\)/);
  return m ? +m[1] : null;
};

const correctness = Object.fromEntries(
  table("## 1. Correctness").map(r => [r[0], { tier: r[1], prepack: r[2], zeroConfig: r[3], optIns: r[4] }])
);
const perf = Object.fromEntries(
  table("## 2. Size, cold start").map(r => {
    const gz = r[2].split("/").map(num);
    const cold = r[3].split("/");
    const cc = r[4].split("/");
    const ex = r[5].split("/");
    return [
      r[0],
      {
        gzipOrigKB: gz[0],
        gzipPrepackKB: gz[1],
        gzipKB: gz[2],
        coldSpeedup: ratio(cold[2]),
        coldOrigMs: num(cold[0]),
        codeCacheSpeedup: ratio(cc[2]),
        execSpeedup: ratio(ex[2]),
      },
    ];
  })
);
const residual = Object.fromEntries(
  table("## 3. Residual-only").map(r => {
    const gz = r[2].split("/").map(num);
    return [r[0], { gzipThrowKB: gz.length === 3 ? gz[2] : null }];
  })
);
const headline = table("## Headline").map(r => r.map(s => s.trim()));

const out = { source: "hybrid/RESULTS.md (H5, final)", headline, workloads: [] };
for (const id of Object.keys(correctness)) {
  out.workloads.push(Object.assign({ id }, correctness[id], { perf: perf[id] || null }, residual[id] || {}));
}
fs.writeFileSync(path.join(__dirname, "../data/freezedry-results.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out.workloads.length, "workloads");
