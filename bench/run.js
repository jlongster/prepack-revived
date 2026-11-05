#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { SPECS } = require("./libs/specs");
const { buildCorpus } = require("./setup");
const { runInVm, runInFreshNode } = require("./harness");
const { OPTION_PROFILES, runProfileInChild } = require("./prepack-worker");
const { measureNodeZeroBaseline, benchmarkTimingsOnly, benchmarkSizesOnly } = require("./perf");

const BENCH_DIR = __dirname;
const REPO_ROOT = path.resolve(BENCH_DIR, "..");
const RESULTS_DIR = path.join(BENCH_DIR, "results");
const MANIFEST_PATH = path.join(BENCH_DIR, "libs", "manifest.json");

function parseArgs(argv) {
  const args = {
    prepack: path.join(REPO_ROOT, "lib", "prepack-node.js"),
    only: null,
    runs: 30,
    warmup: 5,
    timeout: 300000,
    maxOldSpaceMb: 4096,
    jobs: Math.max(1, Math.min(4, os.cpus().length)),
    enableSnapshot: true,
    enablePerf: true,
    outJson: null,
    outMd: path.join(RESULTS_DIR, "latest.md"),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prepack") args.prepack = argv[++i];
    else if (a === "--only") args.only = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--runs") args.runs = parseInt(argv[++i], 10);
    else if (a === "--warmup") args.warmup = parseInt(argv[++i], 10);
    else if (a === "--timeout") args.timeout = parseInt(argv[++i], 10);
    else if (a === "--max-old-space-size") args.maxOldSpaceMb = parseInt(argv[++i], 10);
    else if (a === "--jobs") args.jobs = parseInt(argv[++i], 10);
    else if (a === "--no-snapshot") args.enableSnapshot = false;
    else if (a === "--no-perf") args.enablePerf = false;
    else if (a === "--out-json") args.outJson = argv[++i];
    else if (a === "--out-md") args.outMd = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: node bench/run.js [options]",
          "  --prepack <path>            Path to lib/prepack-node.js or worktree dir (default: ./lib/prepack-node.js)",
          "  --only <id1,id2,...>        Run only selected corpus IDs",
          "  --runs <N>                  Benchmark iterations per metric (default: 30)",
          "  --warmup <N>                Warmup iterations per metric (default: 5)",
          "  --timeout <ms>              Per-lib Prepack timeout in ms (default: 300000)",
          "  --max-old-space-size <MB>   Worker V8 heap cap in MB (default: 4096)",
          "  --jobs <N>                  Parallel Prepack compilation workers (default: min(4, cpus))",
          "  --no-snapshot               Skip Node --build-snapshot reference benchmark",
          "  --no-perf                   Run Prepack triage + digest checks only (skip timing harness)",
          "  --out-json <path>           Override timestamped JSON output path",
          "  --out-md <path>             Override Markdown report path (default: bench/results/latest.md)",
        ].join("\n")
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  let resolved = path.resolve(args.prepack);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const candidate = path.join(resolved, "lib", "prepack-node.js");
    if (fs.existsSync(candidate)) resolved = candidate;
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Prepack entrypoint not found at ${resolved} (did you run 'yarn build-prepack'?)`);
  }
  args.prepack = resolved;
  return args;
}

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      results[myIdx] = await fn(items[myIdx], myIdx);
    }
  });
  await Promise.all(workers);
  return results;
}

function chooseBestOutcome(profileResults) {
  const byName = new Map(profileResults.map(r => [r.profile, r]));
  const def = byName.get("default");
  const eligibleOk = profileResults.filter(r => r.eligibleForNodePerf && r.status === "OK");
  const anyWrong = profileResults.filter(r => r.status === "WRONG");

  // Critical rule: if default is WRONG, surface WRONG unconditionally.
  if (def && def.status === "WRONG") {
    return {
      status: "WRONG",
      defaultStatus: "WRONG",
      bestProfile: null,
      primaryBlocker: def,
    };
  }

  if (eligibleOk.length > 0) {
    // Deterministic preference order: keep modern ES6+ intrinsics when default/browser-opt succeed;
    // only use seeded/node-react/legacy-jsc profiles when required to unlock compilation.
    const preference = ["default", "browser-opt", "browser-seed", "node-react", "jsc"];
    let chosen = eligibleOk[0];
    for (const name of preference) {
      const candidate = byName.get(name);
      if (candidate && candidate.eligibleForNodePerf && candidate.status === "OK") {
        chosen = candidate;
        break;
      }
    }
    // Between default and browser-opt (--delayInitializations --inlineExpressions), pick browser-opt if smaller.
    const opt = byName.get("browser-opt");
    if (
      chosen.profile === "default" &&
      opt &&
      opt.status === "OK" &&
      opt.outBytes < chosen.outBytes
    ) {
      chosen = opt;
    }
    return {
      status: "OK",
      defaultStatus: def ? def.status : "OK",
      bestProfile: chosen,
      primaryBlocker: def && def.status !== "OK" ? def : null,
    };
  }

  if (anyWrong.length > 0 && (!def || def.status !== "FAIL")) {
    return {
      status: "WRONG",
      defaultStatus: def ? def.status : "WRONG",
      bestProfile: null,
      primaryBlocker: anyWrong[0],
    };
  }

  const allTimeout = profileResults.every(r => r.status === "TIMEOUT");
  return {
    status: allTimeout ? "TIMEOUT" : "FAIL",
    defaultStatus: def ? def.status : "FAIL",
    bestProfile: null,
    primaryBlocker: def || profileResults[0],
  };
}

function fmtKb(bytes) {
  if (bytes == null) return "—";
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtMs(val) {
  if (val == null) return "—";
  return `${val.toFixed(2)} ms`;
}

function fmtRatio(r, invertBetter = true) {
  if (r == null) return "—";
  if (invertBetter) {
    return `${r.toFixed(2)}x`;
  }
  return `${r.toFixed(2)}x`;
}

function formatLocation(loc) {
  if (!loc) return "—";
  return `L${loc.line}:${loc.column}`;
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Prepack Real-World Benchmark & Triage Report");
  lines.push("");
  lines.push(`- **Generated**: \`${report.timestamp}\``);
  lines.push(`- **Prepack**: \`${report.prepack.path}\` (version \`${report.prepack.version}\`)`);
  lines.push(
    `- **Environment**: Node \`${report.environment.node}\` on \`${report.environment.platform}/${report.environment.arch}\` (${report.environment.cpus} CPUs, ${(report.environment.totalMemBytes / 1024 / 1024 / 1024).toFixed(1)} GB RAM)`
  );
  lines.push(
    `- **Parameters**: \`runs=${report.config.runs}\`, \`warmup=${report.config.warmup}\`, \`timeout=${report.config.timeout}ms\``
  );
  if (report.nodeZeroBaseline) {
    lines.push(
      `- **\`node -e 0\` Cold Process Baseline**: median **${report.nodeZeroBaseline.median.toFixed(2)} ms** (p90 ${report.nodeZeroBaseline.p90.toFixed(2)} ms)`
    );
  }
  lines.push("");

  const s = report.summary;
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `| Metric | Count | Notes |\n|---|---:|---|\n` +
      `| **Total workloads** | **${s.total}** | ${s.librariesCount} libraries + ${s.appsCount} init-heavy app workloads |\n` +
      `| **OK (default options)** | **${s.defaultOk}** | Digest-identical in fresh \`node\` and \`vm\` with zero flags |\n` +
      `| **OK (best option profile)** | **${s.bestOk}** | Includes libraries unlocked by \`--compatibility\` or \`--mathRandomSeed\` |\n` +
      `| **WRONG (silent miscompile)** | **${s.wrong}** | Prepack exited 0 with no Fatal/Recoverable error, runtime digest/throw differed |\n` +
      `| **FAIL (Prepack error)** | **${s.fail}** | Clean diagnostic (\`PPxxxx\`) or internal serializer error |\n` +
      `| **TIMEOUT** | **${s.timeout}** | Exceeded ${Math.round(report.config.timeout / 1000)}s per-lib cap |`
  );
  lines.push("");

  lines.push("## 1. Per-Library Status & Option Sweep");
  lines.push("");
  lines.push(
    "| Workload | Version (License) | Kind | Raw Size | Default | Best Status | Best Profile | Compile | Top / Default Blocker |"
  );
  lines.push("|---|---|---|---:|---|---|---|---:|---|");
  for (const lib of report.libraries) {
    const pkgStr = lib.packages
      .slice(0, 2)
      .map(p => `${p.name}@${p.version}`)
      .join(" + ") + (lib.packages.length > 2 ? ` (+${lib.packages.length - 2})` : "");
    const licStr = [...new Set(lib.packages.map(p => p.license))].join(", ");
    const b = lib.primaryBlocker;
    let blockerCell = "—";
    if (b) {
      const loc = b.location ? ` @ ${formatLocation(b.location)}` : b.internalFrame ? ` (${b.internalFrame})` : "";
      const msg = String(b.message || "").replace(/\|/g, "\\|").slice(0, 95);
      blockerCell = `\`${b.errorCode}\`${loc}: ${msg}`;
      if (lib.status === "OK" && lib.defaultStatus !== "OK") {
        blockerCell = `*(default ${lib.defaultStatus})* ` + blockerCell;
      }
    }
    lines.push(
      `| **\`${lib.id}\`** | ${pkgStr} (${licStr}) | ${lib.kind === "app-workload" ? "app" : "lib"} | ${fmtKb(lib.bytes)} | **${lib.defaultStatus}** | **${lib.status}** | ${lib.bestProfile ? `\`${lib.bestProfile.profile}\`` : "—"} | ${lib.bestProfile ? `${lib.bestProfile.compileMs} ms` : b ? `${b.compileMs} ms` : "—"} | ${blockerCell} |`
    );
  }
  lines.push("");

  lines.push("### Option Profile Matrix");
  lines.push("");
  const profNames = OPTION_PROFILES.map(p => p.name);
  lines.push(`| Workload | ${profNames.map(n => `\`${n}\``).join(" | ")} |`);
  lines.push(`|---|${profNames.map(() => "---").join("|")}|`);
  for (const lib of report.libraries) {
    const map = new Map(lib.profiles.map(p => [p.profile, p]));
    const cells = profNames.map(n => {
      const r = map.get(n);
      if (!r) return "—";
      if (r.status === "OK") return `OK (${fmtKb(r.outBytes)})`;
      return `${r.status} (\`${r.errorCode}\`)`;
    });
    lines.push(`| \`${lib.id}\` | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const okPerfLibs = report.libraries.filter(l => l.status === "OK" && l.perf);
  if (okPerfLibs.length > 0) {
    lines.push("## 2. Runtime Performance (Original vs Prepacked vs V8 Snapshot)");
    lines.push("");
    lines.push(
      "All timings cover **library load + deterministic smoke-test API suite**, measured over " +
        `\`N=${report.config.runs}\` interleaved runs after \`${report.config.warmup}\` warmups. ` +
        "**Speedup > 1.00x means Prepacked is faster than Original.**"
    );
    lines.push("");
    lines.push(
      "| Workload | Cold `node` Net Med (p90) Orig -> PP | Cold Net Speedup | V8 `cachedData` Med (p90) Orig -> PP | Code-Cache Speedup | VM Exec-Only Med (p90) Orig -> PP | Exec-Only Speedup | V8 `--snapshot-blob` Net Med |"
    );
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const lib of okPerfLibs) {
      const p = lib.perf;
      const coldOrig = `${p.coldProcess.orig.net.median.toFixed(2)} (${p.coldProcess.orig.net.p90.toFixed(2)})`;
      const coldPp = `${p.coldProcess.prepacked.net.median.toFixed(2)} (${p.coldProcess.prepacked.net.p90.toFixed(2)})`;
      const ccOrig = `${p.vmCodeCache.orig.median.toFixed(2)} (${p.vmCodeCache.orig.p90.toFixed(2)})`;
      const ccPp = `${p.vmCodeCache.prepacked.median.toFixed(2)} (${p.vmCodeCache.prepacked.p90.toFixed(2)})`;
      const exOrig = `${p.vmExecOnly.orig.median.toFixed(2)} (${p.vmExecOnly.orig.p90.toFixed(2)})`;
      const exPp = `${p.vmExecOnly.prepacked.median.toFixed(2)} (${p.vmExecOnly.prepacked.p90.toFixed(2)})`;
      const snapStr =
        p.nodeSnapshot && p.nodeSnapshot.supported
          ? `${p.nodeSnapshot.net.median.toFixed(2)} ms (${(p.nodeSnapshot.blobBytes / 1024 / 1024).toFixed(1)} MB)`
          : "n/a";
      lines.push(
        `| **\`${lib.id}\`** | ${coldOrig} -> ${coldPp} ms | **${fmtRatio(p.coldProcess.speedupNet)}** | ${ccOrig} -> ${ccPp} ms | **${fmtRatio(p.vmCodeCache.speedup)}** | ${exOrig} -> ${exPp} ms | **${fmtRatio(p.vmExecOnly.speedup)}** | ${snapStr} |`
      );
    }
    lines.push("");

    lines.push("## 3. Code Size Comparison");
    lines.push("");
    lines.push(
      "`gzip` and `brotli` columns compress the **Terser-minified** code (production wire size). Ratio < 1.00x means Prepacked is smaller than Original."
    );
    lines.push("");
    lines.push(
      "| Workload | Raw Orig -> PP (Ratio) | Terser Orig -> PP (Ratio) | Gzip Orig -> PP (Ratio) | Brotli Orig -> PP (Ratio) |"
    );
    lines.push("|---|---|---|---|---|");
    for (const lib of okPerfLibs) {
      const sz = lib.perf.sizes;
      lines.push(
        `| **\`${lib.id}\`** | ${fmtKb(sz.orig.raw)} -> ${fmtKb(sz.prepacked.raw)} (${sz.ratios.raw.toFixed(2)}x) | ` +
          `${fmtKb(sz.orig.terser)} -> ${fmtKb(sz.prepacked.terser)} (${sz.ratios.terser != null ? sz.ratios.terser.toFixed(2) + "x" : "—"}) | ` +
          `${fmtKb(sz.orig.gzip)} -> ${fmtKb(sz.prepacked.gzip)} (**${sz.ratios.gzip.toFixed(2)}x**) | ` +
          `${fmtKb(sz.orig.brotli)} -> ${fmtKb(sz.prepacked.brotli)} (**${sz.ratios.brotli.toFixed(2)}x**) |`
      );
    }
    lines.push("");
  }

  lines.push("## 4. Diagnostics & Blockers Summary");
  lines.push("");
  for (const lib of report.libraries) {
    if (lib.status === "OK" && lib.defaultStatus === "OK") continue;
    const b = lib.primaryBlocker;
    if (!b) continue;
    lines.push(`### \`${lib.id}\` — default \`${lib.defaultStatus}\`, overall \`${lib.status}\``);
    lines.push(`- **Code**: \`${b.errorCode}\``);
    lines.push(`- **Message**: ${b.message}`);
    if (b.location) {
      lines.push(`- **Location**: line ${b.location.line}, column ${b.location.column}`);
      lines.push(`- **Excerpt**: \`${b.location.snippet}\``);
    }
    if (b.internalFrame) {
      lines.push(`- **Internal Prepack frame**: \`${b.internalFrame}\``);
    }
    if (lib.bestProfile) {
      lines.push(`- **Workaround profile**: \`${lib.bestProfile.profile}\` (\`${lib.bestProfile.cliFlags}\`) -> **OK**`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(MANIFEST_PATH)) {
    buildCorpus();
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const specMap = new Map(SPECS.map(s => [s.id, s]));

  let selected = manifest.libraries;
  if (args.only) {
    const allow = new Set(args.only);
    selected = selected.filter(e => allow.has(e.id));
    if (selected.length === 0) {
      throw new Error(`No corpus entries matched --only=${args.only.join(",")}`);
    }
  }

  let prepackVersion = "unknown";
  try {
    prepackVersion = require(args.prepack).prepackVersion || prepackVersion;
  } catch (e) {
    throw new Error(`Failed to load Prepack at ${args.prepack}: ${e.message}`);
  }

  const tmpRoot = fs.mkdtempSync(path.join("/tmp/opencode", "pp-bench-run-"));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  console.log(`Prepack Real-World Benchmark`);
  console.log(`  prepack: ${args.prepack} (v${prepackVersion})`);
  console.log(`  corpus:  ${selected.length} workloads, ${OPTION_PROFILES.length} option profiles each (${args.jobs} workers)`);
  console.log(`  perf:    ${args.enablePerf ? `runs=${args.runs}, warmup=${args.warmup}, snapshot=${args.enableSnapshot}` : "disabled (--no-perf)"}\n`);

  try {
    // Step 1: Verify plain original digests in VM + fresh Node
    const prepared = [];
    for (const entry of selected) {
      const spec = specMap.get(entry.id);
      const distPath = path.join(BENCH_DIR, entry.file);
      const code = fs.readFileSync(distPath, "utf8");
      const vmOrig = runInVm(code, spec.smokeCode);
      const nodeOrig = runInFreshNode(code, spec.smokeCode, tmpRoot, `orig-${entry.id}`);
      if (!vmOrig.ok || !nodeOrig.ok || vmOrig.digest !== nodeOrig.digest) {
        throw new Error(`Original smoke check failed for ${entry.id}: vm=${JSON.stringify(vmOrig)} node=${JSON.stringify(nodeOrig)}`);
      }
      prepared.push({
        entry,
        spec,
        code,
        expectedDigest: nodeOrig.digest,
        expectedJson: nodeOrig.json,
      });
    }

    // Step 2: Run all (lib x optionProfile) Prepack compilations across worker pool
    const compileTasks = [];
    for (const item of prepared) {
      for (const profile of OPTION_PROFILES) {
        const outCodeFile = path.join(tmpRoot, `pp-${item.entry.id}-${profile.name}.js`);
        compileTasks.push({ item, profile, outCodeFile });
      }
    }

    const flatOutcomes = await runPool(compileTasks, args.jobs, async t => {
      const res = await runProfileInChild(
        {
          id: t.item.entry.id,
          code: t.item.code,
          smokeCode: t.item.spec.smokeCode,
          expectedDigest: t.item.expectedDigest,
          prepackPath: args.prepack,
          profile: t.profile,
          tmpDir: tmpRoot,
          outCodeFile: t.outCodeFile,
        },
        { timeoutMs: args.timeout, maxOldSpaceMb: args.maxOldSpaceMb }
      );
      return { id: t.item.entry.id, res };
    });

    const outcomesByLib = new Map();
    for (const { id, res } of flatOutcomes) {
      if (!outcomesByLib.has(id)) outcomesByLib.set(id, []);
      outcomesByLib.get(id).push(res);
    }

    const libReports = [];
    for (const item of prepared) {
      const profileResults = outcomesByLib.get(item.entry.id) || [];
      const chosen = chooseBestOutcome(profileResults);
      const blockerStr = chosen.primaryBlocker
        ? ` [${chosen.primaryBlocker.errorCode}: ${String(chosen.primaryBlocker.message).slice(0, 72)}]`
        : "";
      console.log(
        `[triage] ${item.entry.id.padEnd(16)} default=${chosen.defaultStatus.padEnd(5)} best=${chosen.status.padEnd(5)}` +
          (chosen.bestProfile ? ` (${chosen.bestProfile.profile}, ${chosen.bestProfile.compileMs}ms)` : "") +
          blockerStr
      );
      libReports.push({
        id: item.entry.id,
        name: item.entry.name,
        kind: item.entry.kind,
        buildType: item.entry.buildType,
        description: item.entry.description,
        bytes: item.entry.bytes,
        sha256: item.entry.sha256,
        packages: item.entry.packages,
        expectedDigest: item.expectedDigest,
        defaultStatus: chosen.defaultStatus,
        status: chosen.status,
        bestProfile: chosen.bestProfile
          ? {
              profile: chosen.bestProfile.profile,
              cliFlags: chosen.bestProfile.cliFlags,
              compileMs: chosen.bestProfile.compileMs,
              outBytes: chosen.bestProfile.outBytes,
            }
          : null,
        primaryBlocker: chosen.primaryBlocker || null,
        profiles: profileResults.map(r => {
          const copy = Object.assign({}, r);
          delete copy.outCodeFile;
          return copy;
        }),
        _bestOutCodeFile: chosen.bestProfile ? chosen.bestProfile.outCodeFile : null,
        _origCode: item.code,
        _smokeCode: item.spec.smokeCode,
        _expectedJson: item.expectedJson,
        perf: null,
      });
    }

    // Step 3: Sequential performance harness (after workers exit so CPU is quiet)
    let nodeZeroBaseline = null;
    if (args.enablePerf) {
      console.log(`\nMeasuring 'node -e 0' baseline (runs=${args.runs}, warmup=${args.warmup}) ...`);
      nodeZeroBaseline = measureNodeZeroBaseline(args.runs, args.warmup);
      console.log(
        `  node -e 0: median=${nodeZeroBaseline.median.toFixed(2)}ms, p90=${nodeZeroBaseline.p90.toFixed(2)}ms\n`
      );

      // Phase 3a: Run all runtime timing benchmarks BEFORE loading Terser, keeping parent heap small for spawnSync.
      for (const lib of libReports) {
        if (lib.status !== "OK" || !lib._bestOutCodeFile) continue;
        const ppCode = fs.readFileSync(lib._bestOutCodeFile, "utf8");
        lib._ppCode = ppCode;
        lib.perf = await benchmarkTimingsOnly(
          lib.id,
          lib._origCode,
          ppCode,
          lib._smokeCode,
          lib._expectedJson,
          tmpRoot,
          {
            runs: args.runs,
            warmup: args.warmup,
            baselineMedian: nodeZeroBaseline.median,
            enableSnapshot: args.enableSnapshot,
          }
        );
      }

      // Phase 3b: Measure raw / Terser-minified / gzip / brotli sizes after all timings complete.
      for (const lib of libReports) {
        if (lib.status !== "OK" || !lib.perf) continue;
        lib.perf.sizes = await benchmarkSizesOnly(lib._origCode, lib._ppCode);
        delete lib._ppCode;
        const perf = lib.perf;
        console.log(
          `[perf]   ${lib.id.padEnd(16)} ` +
            `coldNet: ${perf.coldProcess.orig.net.median.toFixed(2)}->${perf.coldProcess.prepacked.net.median.toFixed(2)}ms (${perf.coldProcess.speedupNet}x) | ` +
            `codeCache: ${perf.vmCodeCache.orig.median.toFixed(2)}->${perf.vmCodeCache.prepacked.median.toFixed(2)}ms (${perf.vmCodeCache.speedup}x) | ` +
            `vmExec: ${perf.vmExecOnly.orig.median.toFixed(2)}->${perf.vmExecOnly.prepacked.median.toFixed(2)}ms (${perf.vmExecOnly.speedup}x) | ` +
            `gzip: ${fmtKb(perf.sizes.orig.gzip)}->${fmtKb(perf.sizes.prepacked.gzip)} (${perf.sizes.ratios.gzip}x)`
        );
      }
    }

    for (const lib of libReports) {
      delete lib._bestOutCodeFile;
      delete lib._origCode;
      delete lib._smokeCode;
      delete lib._expectedJson;
    }

    const now = new Date();
    const stamp = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const jsonPath = args.outJson ? path.resolve(args.outJson) : path.join(RESULTS_DIR, `${stamp}.json`);
    const mdPath = path.resolve(args.outMd);

    const summary = {
      total: libReports.length,
      librariesCount: libReports.filter(l => l.kind === "library").length,
      appsCount: libReports.filter(l => l.kind === "app-workload").length,
      defaultOk: libReports.filter(l => l.defaultStatus === "OK").length,
      bestOk: libReports.filter(l => l.status === "OK").length,
      wrong: libReports.filter(l => l.status === "WRONG").length,
      fail: libReports.filter(l => l.status === "FAIL").length,
      timeout: libReports.filter(l => l.status === "TIMEOUT").length,
    };

    const report = {
      timestamp: now.toISOString(),
      prepack: {
        path: args.prepack,
        version: prepackVersion,
      },
      environment: {
        node: process.version,
        v8: process.versions.v8,
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0] ? os.cpus()[0].model : "unknown",
        totalMemBytes: os.totalmem(),
      },
      config: {
        runs: args.runs,
        warmup: args.warmup,
        timeout: args.timeout,
        maxOldSpaceMb: args.maxOldSpaceMb,
        enableSnapshot: args.enableSnapshot,
        only: args.only,
      },
      nodeZeroBaseline,
      summary,
      libraries: libReports,
    };

    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report) + "\n", "utf8");

    console.log(`\nWrote JSON results -> ${path.relative(REPO_ROOT, jsonPath)}`);
    console.log(`Wrote Markdown     -> ${path.relative(REPO_ROOT, mdPath)}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
