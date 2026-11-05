"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const childProcess = require("child_process");
const { makeSandbox, buildVmRunnerSource, buildNodeStandaloneScript } = require("./harness");

const BENCH_NM = path.join(__dirname, "node_modules");

function round(n, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function summarizeSamples(samples) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, median: 0, p90: 0, mean: 0, min: 0, max: 0 };
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p90Idx = Math.min(n - 1, Math.ceil(0.9 * n) - 1);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    median: round(median, 3),
    p90: round(sorted[p90Idx], 3),
    mean: round(mean, 3),
    min: round(sorted[0], 3),
    max: round(sorted[n - 1], 3),
  };
}

function measureNodeZeroBaseline(runs = 30, warmup = 5) {
  const env = Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" });
  for (let i = 0; i < warmup; i++) {
    const r = childProcess.spawnSync(process.execPath, ["-e", "0"], { env, stdio: "ignore" });
    if (r.status !== 0) throw new Error("node -e 0 failed during warmup");
  }
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    const r = childProcess.spawnSync(process.execPath, ["-e", "0"], { env, stdio: "ignore" });
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.status !== 0) throw new Error("node -e 0 failed");
    samples.push(dt);
  }
  return summarizeSamples(samples);
}

function loadTerser() {
  try {
    return require(path.join(BENCH_NM, "terser"));
  } catch (_e) {
    return null;
  }
}

function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function brotliSize(buf) {
  return zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 },
  }).length;
}

async function measureSizes(code) {
  const rawBuf = Buffer.from(code, "utf8");
  const raw = rawBuf.length;
  const rawGzip = gzipSize(rawBuf);
  const rawBrotli = brotliSize(rawBuf);

  let terserBytes = null;
  let terserGzip = null;
  let terserBrotli = null;
  const terser = loadTerser();
  if (terser) {
    const min = await terser.minify(code, {
      ecma: 2020,
      compress: true,
      mangle: true,
      output: { comments: false },
    });
    if (min && typeof min.code === "string") {
      const minBuf = Buffer.from(min.code, "utf8");
      terserBytes = minBuf.length;
      terserGzip = gzipSize(minBuf);
      terserBrotli = brotliSize(minBuf);
    }
  }

  return {
    raw,
    terser: terserBytes,
    gzip: terserGzip !== null ? terserGzip : rawGzip,
    brotli: terserBrotli !== null ? terserBrotli : rawBrotli,
    rawGzip,
    rawBrotli,
  };
}

function subtractBaseline(stats, baseMedian) {
  return {
    median: round(Math.max(0, stats.median - baseMedian), 3),
    p90: round(Math.max(0, stats.p90 - baseMedian), 3),
    mean: round(Math.max(0, stats.mean - baseMedian), 3),
  };
}

function measureColdStartup(origCode, ppCode, smokeCode, expectedJson, workDir, opts) {
  const { runs, warmup } = opts;
  const origFile = path.join(workDir, "orig-cold.js");
  const ppFile = path.join(workDir, "pp-cold.js");
  fs.writeFileSync(origFile, buildNodeStandaloneScript(origCode, smokeCode, { printDigest: false, expectedJson }), "utf8");
  fs.writeFileSync(ppFile, buildNodeStandaloneScript(ppCode, smokeCode, { printDigest: false, expectedJson }), "utf8");

  const env = Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" });
  const spawnOnce = argv => {
    const t0 = process.hrtime.bigint();
    const r = childProcess.spawnSync(process.execPath, argv, { env, stdio: "ignore", timeout: 30000 });
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.status !== 0) {
      throw new Error(`Cold startup benchmark failed (${argv.join(" ")} exited with ${r.status})`);
    }
    return dt;
  };

  for (let i = 0; i < warmup; i++) {
    spawnOnce(["-e", "0"]);
    spawnOnce([origFile]);
    spawnOnce([ppFile]);
  }

  const zeroSamples = [];
  const origSamples = [];
  const ppSamples = [];
  for (let i = 0; i < runs; i++) {
    zeroSamples.push(spawnOnce(["-e", "0"]));
    if (i % 2 === 0) {
      origSamples.push(spawnOnce([origFile]));
      ppSamples.push(spawnOnce([ppFile]));
    } else {
      ppSamples.push(spawnOnce([ppFile]));
      origSamples.push(spawnOnce([origFile]));
    }
  }

  const localZero = summarizeSamples(zeroSamples);
  const origRaw = summarizeSamples(origSamples);
  const ppRaw = summarizeSamples(ppSamples);
  const origNet = subtractBaseline(origRaw, localZero.median);
  const ppNet = subtractBaseline(ppRaw, localZero.median);

  return {
    baseline: localZero,
    orig: { raw: origRaw, net: origNet },
    prepacked: { raw: ppRaw, net: ppNet },
    speedupRaw: ppRaw.median > 0 ? round(origRaw.median / ppRaw.median, 3) : null,
    speedupNet: ppNet.median > 0 ? round(origNet.median / ppNet.median, 3) : null,
  };
}

function measureVmCodeCache(origCode, ppCode, smokeCode, expectedJson, opts) {
  const { runs, warmup } = opts;
  const origSrc = buildVmRunnerSource(origCode, smokeCode);
  const ppSrc = buildVmRunnerSource(ppCode, smokeCode);

  const origCachedData = new vm.Script(origSrc, { filename: "orig-cached.js" }).createCachedData();
  const ppCachedData = new vm.Script(ppSrc, { filename: "pp-cached.js" }).createCachedData();

  const runCached = (src, cachedData, filename) => {
    const sandbox = makeSandbox();
    const ctx = vm.createContext(sandbox);
    const t0 = process.hrtime.bigint();
    const script = new vm.Script(src, { filename, cachedData });
    if (script.cachedDataRejected) {
      throw new Error(`V8 rejected cachedData for ${filename}`);
    }
    const out = script.runInContext(ctx);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (out !== expectedJson) {
      throw new Error(`Digest mismatch in cachedData run for ${filename}`);
    }
    return dt;
  };

  for (let i = 0; i < warmup; i++) {
    runCached(origSrc, origCachedData, "orig-cached.js");
    runCached(ppSrc, ppCachedData, "pp-cached.js");
  }

  const origSamples = [];
  const ppSamples = [];
  for (let i = 0; i < runs; i++) {
    if (i % 2 === 0) {
      origSamples.push(runCached(origSrc, origCachedData, "orig-cached.js"));
      ppSamples.push(runCached(ppSrc, ppCachedData, "pp-cached.js"));
    } else {
      ppSamples.push(runCached(ppSrc, ppCachedData, "pp-cached.js"));
      origSamples.push(runCached(origSrc, origCachedData, "orig-cached.js"));
    }
  }

  const origStats = summarizeSamples(origSamples);
  const ppStats = summarizeSamples(ppSamples);
  return {
    orig: Object.assign({}, origStats, { cachedDataBytes: origCachedData.length }),
    prepacked: Object.assign({}, ppStats, { cachedDataBytes: ppCachedData.length }),
    speedup: ppStats.median > 0 ? round(origStats.median / ppStats.median, 3) : null,
  };
}

function measureVmExecOnly(origCode, ppCode, smokeCode, expectedJson, opts) {
  const { runs, warmup } = opts;
  const origSrc = buildVmRunnerSource(origCode, smokeCode);
  const ppSrc = buildVmRunnerSource(ppCode, smokeCode);

  const origScript = new vm.Script(origSrc, { filename: "orig-exec.js" });
  const ppScript = new vm.Script(ppSrc, { filename: "pp-exec.js" });

  const runExec = script => {
    const ctx = vm.createContext(makeSandbox());
    const t0 = process.hrtime.bigint();
    const out = script.runInContext(ctx);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (out !== expectedJson) {
      throw new Error("Digest mismatch in VM exec-only run");
    }
    return dt;
  };

  for (let i = 0; i < warmup; i++) {
    runExec(origScript);
    runExec(ppScript);
  }

  const origSamples = [];
  const ppSamples = [];
  for (let i = 0; i < runs; i++) {
    if (i % 2 === 0) {
      origSamples.push(runExec(origScript));
      ppSamples.push(runExec(ppScript));
    } else {
      ppSamples.push(runExec(ppScript));
      origSamples.push(runExec(origScript));
    }
  }

  const origStats = summarizeSamples(origSamples);
  const ppStats = summarizeSamples(ppSamples);
  return {
    orig: origStats,
    prepacked: ppStats,
    speedup: ppStats.median > 0 ? round(origStats.median / ppStats.median, 3) : null,
  };
}

function measureNodeSnapshot(origCode, smokeCode, expectedJson, workDir, opts) {
  const { runs, warmup, baselineMedian } = opts;
  const snapEntry = path.join(workDir, "snap-entry.js");
  const snapBlob = path.join(workDir, "snapshot.blob");
  const smokeFile = path.join(workDir, "snap-smoke.js");

  fs.writeFileSync(
    snapEntry,
    `globalThis.global = globalThis;
globalThis.self = globalThis;
globalThis.window = globalThis;
(function(exports, module, define) {
${origCode}
}).call(globalThis);
`,
    "utf8"
  );
  fs.writeFileSync(
    smokeFile,
    `const __out = (${smokeCode})(globalThis);
if (__out !== ${JSON.stringify(expectedJson)}) process.exit(3);
`,
    "utf8"
  );

  const env = Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" });
  const buildRes = childProcess.spawnSync(
    process.execPath,
    ["--snapshot-blob", snapBlob, "--build-snapshot", snapEntry],
    { env, encoding: "utf8", timeout: 30000 }
  );
  if (buildRes.status !== 0 || !fs.existsSync(snapBlob)) {
    const errMsg = (buildRes.stderr || "").trim().split("\n").slice(0, 2).join(" | ");
    return { supported: false, error: errMsg || `exit ${buildRes.status}` };
  }

  const blobBuf = fs.readFileSync(snapBlob);
  const blobBytes = blobBuf.length;
  const blobGzipBytes = gzipSize(blobBuf);

  const runOnce = () => {
    const t0 = process.hrtime.bigint();
    const r = childProcess.spawnSync(process.execPath, ["--snapshot-blob", snapBlob, smokeFile], {
      env,
      stdio: "ignore",
      timeout: 30000,
    });
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.status !== 0) return { ok: false, status: r.status };
    return { ok: true, dt };
  };

  for (let i = 0; i < warmup; i++) {
    const w = runOnce();
    if (!w.ok) return { supported: false, error: `snapshot runtime exited ${w.status}` };
  }

  const zeroSamples = [];
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    childProcess.spawnSync(process.execPath, ["-e", "0"], { env, stdio: "ignore", timeout: 30000 });
    zeroSamples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    const r = runOnce();
    if (!r.ok) return { supported: false, error: `snapshot runtime exited ${r.status}` };
    samples.push(r.dt);
  }

  const localZero = summarizeSamples(zeroSamples);
  const raw = summarizeSamples(samples);
  const net = subtractBaseline(raw, localZero.median);
  return {
    supported: true,
    blobBytes,
    blobGzipBytes,
    baseline: localZero,
    raw,
    net,
  };
}

async function benchmarkTimingsOnly(id, origCode, ppCode, smokeCode, expectedJson, tmpRoot, opts) {
  const workDir = path.join(tmpRoot, `perf-${id}`);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const cold = measureColdStartup(origCode, ppCode, smokeCode, expectedJson, workDir, opts);
    const codeCache = measureVmCodeCache(origCode, ppCode, smokeCode, expectedJson, opts);
    const vmExec = measureVmExecOnly(origCode, ppCode, smokeCode, expectedJson, opts);
    const snapshot = opts.enableSnapshot
      ? measureNodeSnapshot(origCode, smokeCode, expectedJson, workDir, opts)
      : null;
    return {
      coldProcess: cold,
      vmCodeCache: codeCache,
      vmExecOnly: vmExec,
      nodeSnapshot: snapshot,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function benchmarkSizesOnly(origCode, ppCode) {
  const [origSizes, ppSizes] = await Promise.all([measureSizes(origCode), measureSizes(ppCode)]);
  return {
    orig: origSizes,
    prepacked: ppSizes,
    ratios: {
      raw: round(ppSizes.raw / origSizes.raw, 3),
      terser:
        ppSizes.terser !== null && origSizes.terser !== null
          ? round(ppSizes.terser / origSizes.terser, 3)
          : null,
      gzip: round(ppSizes.gzip / origSizes.gzip, 3),
      brotli: round(ppSizes.brotli / origSizes.brotli, 3),
    },
  };
}

async function benchmarkLibrary(id, origCode, ppCode, smokeCode, expectedJson, tmpRoot, opts) {
  const timings = await benchmarkTimingsOnly(id, origCode, ppCode, smokeCode, expectedJson, tmpRoot, opts);
  const sizes = await benchmarkSizesOnly(origCode, ppCode);
  return Object.assign({ sizes }, timings);
}

module.exports = {
  measureNodeZeroBaseline,
  benchmarkTimingsOnly,
  benchmarkSizesOnly,
  benchmarkLibrary,
};
