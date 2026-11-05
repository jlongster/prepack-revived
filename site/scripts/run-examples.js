// Runs every example in site/examples/manifest.js through the real tools and records
// their exact output in site/data/examples.json. The site build only reads that file,
// so every code panel on the page is a verbatim tool output.
//
//   node site/scripts/run-examples.js            # all examples
//   node site/scripts/run-examples.js loops-1722 # only the listed ids (others are kept)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SITE = path.resolve(__dirname, "..");
const REPO = path.resolve(SITE, "..");
const TOOLS = {
  orig: {
    label: "Prepack 0.2.54",
    cmd: process.env.PP_ORIG || "/tmp/opencode/pp-lab/node_modules/prepack/lib/prepack-cli.js",
  },
  revived: { label: "Revived Prepack", cmd: process.env.PP_REVIVED || path.join(REPO, "lib/prepack-cli.js") },
  hybrid: {
    label: "Hybrid",
    cmd: process.env.PP_HYBRID || "/tmp/opencode/pp-wt/hybrid/hybrid/bin/hybrid.js",
  },
};

const manifest = require(path.join(SITE, "examples/manifest.js"));
const only = process.argv.slice(2);
const dataFile = path.join(SITE, "data/examples.json");
const data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, "utf8")) : {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-story-"));

for (const ex of manifest) {
  if (only.length && !only.includes(ex.id)) continue;
  const inputPath = path.join(SITE, "examples", ex.input);
  const input = fs.readFileSync(inputPath, "utf8");
  const result = { input, inputName: ex.input, tools: {}, probes: [] };
  for (const tool of ex.tools || ["orig", "revived"]) {
    const args = (ex.args && ex.args[tool]) || [];
    const t0 = Date.now();
    // Run from the examples directory so diagnostics print the short file name.
    const r = spawnSync(process.execPath, [TOOLS[tool].cmd, ex.input, ...args], {
      cwd: path.join(SITE, "examples"),
      encoding: "utf8",
      timeout: ex.timeout || 60000,
      maxBuffer: 256 * 1024 * 1024,
      env: Object.assign({}, process.env, { TZ: "UTC", LANG: "C" }),
    });
    result.tools[tool] = {
      label: TOOLS[tool].label,
      command: [path.basename(TOOLS[tool].cmd), ex.input, ...args].join(" "),
      exitCode: r.status,
      timedOut: r.error && r.error.code === "ETIMEDOUT",
      ms: Date.now() - t0,
      stdout: r.stdout || "",
      stderr: (r.stderr || "").replace(new RegExp(REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<repo>"),
    };
    console.log(`${ex.id} ${tool}: exit ${r.status} ${result.tools[tool].ms}ms ${(r.stdout || "").length}B`);
  }
  for (const probe of ex.probes || []) {
    const row = { label: probe.label, original: run(input, probe, ex.input) };
    for (const tool of Object.keys(result.tools)) {
      const t = result.tools[tool];
      row[tool] = t.stdout.trim() ? run(t.stdout, probe, tool + ".js") : null;
    }
    result.probes.push(row);
    console.log("  probe", probe.label, JSON.stringify(row));
  }
  data[ex.id] = result;
}

fs.writeFileSync(dataFile, JSON.stringify(data, null, 1) + "\n");

function run(code, probe, filename) {
  const job = path.join(tmp, "job.json");
  fs.writeFileSync(job, JSON.stringify({ code, prelude: probe.prelude || "", probe: probe.probe, filename }));
  const r = spawnSync(process.execPath, [path.join(__dirname, "exec-snippet.js"), job], {
    encoding: "utf8",
    timeout: 20000,
    env: Object.assign({}, process.env, probe.env || {}),
  });
  if (r.status !== 0 || !r.stdout) return { ok: false, value: "process failed: " + (r.stderr || "").split("\n")[0] };
  return JSON.parse(r.stdout);
}
