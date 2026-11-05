/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// Fuzzer driver: generates programs on a pool of workers for --time seconds,
// classifies each run (see run.js), saves failures, then minimizes and dedupes
// them. Run with --help for options.

const fs = require("fs");
const path = require("path");
const { Pool } = require("./pool");
const { parseArgs } = require("./args");
const { minimize, failureKey } = require("./minimize");

const FAILURE_CLASSES = ["wrong", "wrong-recovered", "invariant", "crash"];

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const failureClasses = args.fatalFails ? FAILURE_CLASSES.concat(["fatal"]) : FAILURE_CLASSES;
  fs.mkdirSync(path.join(args.out, "raw"), { recursive: true });
  log(`prepack: ${args.prepack}`);
  log(`mode: ${args.mode}  seed: ${args.seed}  jobs: ${args.jobs}  time: ${args.time || "∞"}s  out: ${args.out}`);

  const pool = new Pool(args.jobs, args.runOptions, args.timeout);
  const stats = {};
  const fatalCodes = {};
  const failures = [];
  const started = Date.now();
  let index = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    log("stopping (Ctrl-C again to quit without minimizing)");
  });
  const timer = setInterval(() => log(`${elapsed(started)} ${statsLine(stats)}`), 15000);

  const done = () => stopping || index >= args.count || (args.time > 0 && Date.now() - started >= args.time * 1000);
  async function lane() {
    while (!done()) {
      const seed = args.seed + index++;
      const mode = args.mode === "both" ? (seed % 2 ? "classic" : "extended") : args.mode;
      const result = await pool.run({ mode, seed });
      stats[result.status] = (stats[result.status] || 0) + 1;
      if (result.status === "fatal") {
        const code = (result.detail || "").split(":")[0];
        fatalCodes[code] = (fatalCodes[code] || 0) + 1;
      }
      if (failureClasses.includes(result.status)) {
        const file = path.join(args.out, "raw", `${result.status}-${mode}-${seed}.js`);
        fs.writeFileSync(file, header(result, mode, seed) + result.code);
        failures.push({ file, mode, seed, result, key: failureKey(result) });
        log(`${result.status} ${mode} seed ${seed}: ${firstLine(result.detail || "") || "output differs"}`);
      } else if (result.status === "harness-error") {
        log(`harness error on seed ${seed}: ${firstLine(result.detail)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: args.jobs * 2 }, lane));
  clearInterval(timer);
  const fuzzSeconds = (Date.now() - started) / 1000;
  log(`fuzzing done after ${elapsed(started)}: ${statsLine(stats)}`);

  // Minimize: one failure per distinct crash/invariant signature, up to N wrong outputs.
  const minimized = [];
  if (args.minimize > 0 && failures.length) {
    fs.mkdirSync(path.join(args.out, "min"), { recursive: true });
    stopping = false;
    const picked = pickForMinimization(failures, args.maxMinimize);
    log(`minimizing ${picked.length} of ${failures.length} failures (${args.minimize}s budget each)`);
    for (const f of picked) {
      if (stopping) break;
      const r = await minimize(pool, f.result.code, f.result, { time: args.minimize, batch: args.jobs });
      const shape = normalizeCode(r.code);
      const dupe = minimized.find(m => m.key === f.key && (f.key.startsWith("wrong") ? m.shape === shape : true));
      if (dupe) {
        dupe.seeds.push(f.seed);
        log(`  ${f.result.status} seed ${f.seed}: duplicate of ${path.basename(dupe.file)}`);
        continue;
      }
      const file = path.join(args.out, "min", `${f.result.status}-${minimized.length + 1}.js`);
      fs.writeFileSync(file, header(r.result, f.mode, f.seed) + r.code);
      minimized.push({ file, key: f.key, shape, seeds: [f.seed], status: r.result.status, detail: r.result.detail });
      log(
        `  ${f.result.status} seed ${f.seed}: ${f.result.code.length}B -> ${r.code.length}B in ${
          r.tests
        } runs -> ${file}`
      );
    }
  }
  pool.close();

  const summary = {
    prepack: args.prepack,
    mode: args.mode,
    seed: args.seed,
    jobs: args.jobs,
    seconds: Math.round(fuzzSeconds),
    programs: index,
    stats,
    fatalCodes,
    failures: failures.map(f => ({ file: f.file, status: f.result.status, detail: f.result.detail, key: f.key })),
    minimized: minimized.map(m => ({ file: m.file, status: m.status, detail: m.detail, seeds: m.seeds })),
  };
  fs.writeFileSync(path.join(args.out, "summary.json"), JSON.stringify(summary, null, 2));
  log(`programs: ${summary.programs}  ${statsLine(stats)}`);
  log(
    `fatal codes: ${Object.entries(fatalCodes)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}×${n}`)
      .join(" ") || "none"}`
  );
  for (const m of minimized)
    log(
      `  ${m.status}: ${path.relative(process.cwd(), m.file)} (${m.seeds.length} seed(s)) ${firstLine(m.detail || "")}`
    );
  log(`summary: ${path.join(args.out, "summary.json")}`);
  process.exit(failures.length ? 1 : 0);
}

function pickForMinimization(failures, max) {
  const perKey = new Map();
  const picked = [];
  // Smallest programs first: they minimize fastest and tend to be the clearest repro.
  for (const f of failures.slice().sort((a, b) => a.result.code.length - b.result.code.length)) {
    const n = perKey.get(f.key) || 0;
    const limit = f.key.startsWith("wrong") ? max : 2;
    if (n >= limit) continue;
    perKey.set(f.key, n + 1);
    picked.push(f);
  }
  return picked;
}

function normalizeCode(code) {
  // Collapse identifier numbering and the harness so equal shapes compare equal.
  const i = code.indexOf("inspect = function");
  return (i > 0 ? code.slice(0, i) : code).replace(/\b([a-zA-Z]+)\d+\b/g, "$1").replace(/\s+/g, " ");
}

function header(result, mode, seed) {
  const lines = [`// fuzz: ${result.status} (mode ${mode}, seed ${seed})`];
  if (result.detail) lines.push(`// detail: ${firstLine(result.detail)}`);
  if (result.codes && result.codes.length) lines.push(`// codes: ${result.codes.join(" ")}`);
  if (result.expected !== undefined && result.actual !== undefined && result.expected !== result.actual) {
    lines.push(`// expected: ${JSON.stringify(result.expected)}`);
    lines.push(`// actual:   ${JSON.stringify(result.actual)}`);
  }
  if (result.stack) for (const l of result.stack.split("\n")) lines.push(`//   ${l}`);
  return lines.join("\n") + "\n";
}

function statsLine(stats) {
  return Object.entries(stats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

function elapsed(started) {
  const s = Math.round((Date.now() - started) / 1000);
  return `[${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s]`;
}

function firstLine(s) {
  return String(s)
    .split("\n")[0]
    .slice(0, 200);
}

function log(s) {
  console.log(s);
}

main();
