/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @noflow (plain Node script; not @flow-typed) */

/*
 * Scoreboard for the hard-case corpus in test/serializer/hard.
 *
 * Plain Node script (no build step needed):
 *   node scripts/hard-scoreboard.js [--prepack <lib/prepack-node.js | package dir>] [--filter <substr>]
 *                                   [--timeout <ms>] [--jobs <n>] [--json <path>] [--verbose] [--check-plain]
 *
 * Every test is classified as
 *   PASS  - no FatalError/RecoverableError, residual inspect() equals original inspect(),
 *           output size <= max ratio (default 2x) of the input and all "// does (not) contain:" markers hold
 *   CRASH - FatalError/RecoverableError diagnostic, invariant, other exception or timeout
 *   WRONG - Prepack reported success, but the residual inspect() differs from the original (silent miscompile)
 *   BLOAT - correct, but output too large or a goal marker failed
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const childProcess = require("child_process");

const SELF = path.resolve(process.argv[1]);
const ROOT = path.join(__dirname, "..");
const HARD_DIR = path.join(ROOT, "test", "serializer", "hard");
const LAB_PREPACK = "/tmp/opencode/pp-lab/node_modules/prepack";
const STATUSES = ["PASS", "CRASH", "WRONG", "BLOAT"];
const EXEC_TIMEOUT = 10000;

function parseArgs(argv) {
  let args = {
    prepack: undefined,
    filter: "",
    timeout: 30000,
    jobs: Math.max(1, Math.min(8, os.cpus().length - 1)),
    json: path.join(HARD_DIR, "results.json"),
    verbose: false,
    checkPlain: false,
    mode: "main",
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === "--prepack") args.prepack = argv[++i];
    else if (a === "--filter") args.filter = argv[++i];
    else if (a === "--timeout") args.timeout = +argv[++i];
    else if (a === "--jobs") args.jobs = +argv[++i];
    else if (a === "--json") args.json = argv[++i];
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--check-plain") args.checkPlain = true;
    else if (a === "--worker") args.mode = "worker";
    else if (a === "--exec") args.mode = "exec";
    else throw new Error(`unknown argument ${a}`);
  }
  if (args.prepack === undefined) {
    let local = path.join(ROOT, "lib", "prepack-node.js");
    args.prepack = fs.existsSync(local) ? local : LAB_PREPACK;
  }
  args.prepack = path.resolve(args.prepack);
  return args;
}

function listTests(dir) {
  return fs
    .readdirSync(dir)
    .sort()
    .reduce((acc, name) => {
      let loc = path.join(dir, name);
      if (fs.statSync(loc).isDirectory()) return acc.concat(listTests(loc));
      if (name.endsWith(".js") && name[0] !== ".") acc.push(loc);
      return acc;
    }, []);
}

// Header and marker parsing. Markers follow scripts/test-runner.js.
function parseTest(code) {
  let line = marker => {
    let i = code.indexOf(marker);
    return i < 0 ? undefined : code.substring(i + marker.length, code.indexOf("\n", i)).trim();
  };
  let markers = [];
  for (let [positive, marker] of [[true, "// does contain:"], [false, "// does not contain:"]]) {
    for (let i = code.indexOf(marker); i >= 0; i = code.indexOf(marker, i + 1)) {
      markers.push({ positive, value: code.substring(i + marker.length, code.indexOf("\n", i)) });
    }
  }
  let runtimeEnv;
  let envLine = line("// runtime env:");
  if (envLine !== undefined) {
    runtimeEnv = {};
    for (let kv of envLine.split(/\s+/)) {
      let eq = kv.indexOf("=");
      runtimeEnv[kv.substring(0, eq)] = kv.substring(eq + 1);
    }
  }
  let ratio = line("// max size ratio:");
  let opts = line("// prepack options:");
  return {
    problem: line("// hard:"),
    source: line("// source:"),
    goal: line("// goal:"),
    addedCode: line("// add at runtime:") || "",
    maxRatio: ratio !== undefined ? +ratio : 2,
    prepackOptions: opts !== undefined ? JSON.parse(opts) : {},
    markers,
    runtimeEnv,
  };
}

// Same sandbox as execInContext in scripts/test-runner.js.
function execInContext(code) {
  let result = "";
  let logOutput = "";
  let write = (prefix, values) => {
    logOutput += "\n" + prefix + values.join("");
  };
  try {
    new vm.Script(`var global = this;\nvar self = this;\n${code}\nreport(inspect());`).runInNewContext(
      {
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        report: s => {
          result = s;
        },
        console: {
          log: (...s) => write("", s),
          warn: (...s) => write("WARN:", s),
          error: (...s) => write("ERROR:", s),
        },
      },
      { timeout: EXEC_TIMEOUT }
    );
  } catch (e) {
    return Promise.resolve({ value: "" + e, threw: true });
  }
  if (result && typeof result.then === "function") {
    let timer;
    let timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve({ value: "Error: inspect() promise timed out", threw: true }), EXEC_TIMEOUT);
    });
    let done = result.then(
      v => ({ value: (v + logOutput).trim(), threw: false }),
      e => ({ value: "" + e, threw: true })
    );
    return Promise.race([done, timeout]).then(r => {
      clearTimeout(timer);
      return r;
    });
  }
  return Promise.resolve({ value: (result + logOutput).trim(), threw: false });
}

// Executes in a separate process when the test asks for a different runtime environment (e.g. TZ),
// so that build-time and run-time environments differ.
function execCode(code, runtimeEnv) {
  if (runtimeEnv === undefined) return execInContext(code);
  let r = childProcess.spawnSync(process.execPath, [SELF, "--exec"], {
    input: code,
    env: Object.assign({}, process.env, runtimeEnv),
    timeout: EXEC_TIMEOUT + 2000,
    encoding: "utf8",
  });
  if (r.status !== 0) return Promise.resolve({ value: "Error: exec subprocess failed " + r.stderr, threw: true });
  return Promise.resolve(JSON.parse(r.stdout));
}

function wrapOriginal(t, code) {
  return `${t.addedCode}\n(function () {${code} // keep newline here as code may end with comment\n}).call(this);`;
}

function minifiedSize(code) {
  let parser = requireBabel("@babel/parser");
  let generate = requireBabel("@babel/generator").default;
  try {
    let ast = parser.parse(code, { sourceType: "script", allowReturnOutsideFunction: true });
    return generate(ast, { comments: false, compact: true, minified: true }).code.length;
  } catch (e) {
    return code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "").length;
  }
}

function requireBabel(name) {
  for (let base of [ROOT, LAB_PREPACK, path.dirname(LAB_PREPACK)]) {
    try {
      return require(require.resolve(name, { paths: [base] }));
    } catch (e) {
      // try next location
    }
  }
  throw new Error(`cannot find ${name}`);
}

function firstLine(s) {
  return String(s)
    .split("\n")[0]
    .slice(0, 200);
}

async function runOne(file, prepackPath) {
  let code = fs.readFileSync(file, "utf8");
  let t = parseTest(code);
  let res = {
    test: path.relative(HARD_DIR, file),
    problem: t.problem,
    source: t.source,
    goal: t.goal,
    status: undefined,
    detail: "",
    codes: [],
  };
  let expected = await execCode(wrapOriginal(t, code), t.runtimeEnv);
  res.expected = expected.value.slice(0, 500);
  let prepack = require(prepackPath);
  let diags = [];
  let options = Object.assign(
    {
      serialize: true,
      uniqueSuffix: "",
      internalDebug: true,
      errorHandler: d => {
        diags.push(d);
        return d.severity === "FatalError" ? "Fail" : "Recover";
      },
    },
    t.prepackOptions
  );
  let serialized;
  let exception;
  let started = Date.now();
  try {
    serialized = prepack.prepackSources([{ filePath: res.test, fileContents: code, sourceMapContents: "" }], options);
  } catch (e) {
    exception = e;
  }
  res.prepackMs = Date.now() - started;
  let errors = diags.filter(d => d.severity === "FatalError" || d.severity === "RecoverableError");
  res.codes = [...new Set(errors.map(d => d.errorCode))];
  res.warnings = [...new Set(diags.filter(d => d.severity === "Warning").map(d => d.errorCode))];
  if (exception !== undefined || errors.length > 0) {
    res.status = "CRASH";
    let isFatal = exception !== undefined && exception.constructor && exception.constructor.name === "FatalError";
    if (exception !== undefined && (!isFatal || errors.length === 0)) {
      res.detail = `${isFatal ? "FatalError" : exception.name || "Error"}: ${firstLine(exception.message)}`;
    } else {
      let counts = new Map();
      for (let d of errors) {
        let key = `${d.severity} ${d.errorCode}: ${firstLine(d.message).trim()}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      res.detail = [...counts].map(([k, n]) => (n > 1 ? `${k} (x${n})` : k)).join("; ");
    }
    if (exception === undefined && serialized) {
      // Prepack recovered (e.g. pure-scope bail out) but reported an error; record whether the output was right.
      let actual = await execCode(t.addedCode + "\n" + serialized.code, t.runtimeEnv);
      res.recoveredOutput = actual.value === expected.value ? "correct" : "wrong";
      res.actual = actual.value.slice(0, 500);
    }
    return res;
  }
  let actual = await execCode(t.addedCode + "\n" + serialized.code, t.runtimeEnv);
  res.actual = actual.value.slice(0, 500);
  res.inBytes = minifiedSize(code);
  res.outBytes = minifiedSize(serialized.code);
  res.ratio = Math.round((res.outBytes / res.inBytes) * 100) / 100;
  if (actual.value !== expected.value) {
    res.status = "WRONG";
    res.residualThrows = actual.threw && !expected.threw;
    res.detail = `expected ${JSON.stringify(firstLine(expected.value))} got ${JSON.stringify(firstLine(actual.value))}`;
    res.output = serialized.code;
    return res;
  }
  let failedMarkers = t.markers.filter(m => serialized.code.includes(m.value) !== m.positive);
  if (failedMarkers.length > 0) {
    res.status = "BLOAT";
    res.detail = failedMarkers.map(m => `${m.positive ? "missing" : "contains"} ${JSON.stringify(m.value)}`).join("; ");
    return res;
  }
  if (res.ratio > t.maxRatio) {
    res.status = "BLOAT";
    res.detail = `output ${res.outBytes}B is ${res.ratio}x input ${res.inBytes}B (max ${t.maxRatio}x)`;
    return res;
  }
  res.status = "PASS";
  return res;
}

async function checkPlain(file) {
  let code = fs.readFileSync(file, "utf8");
  let t = parseTest(code);
  let problems = [];
  if (!t.problem || !t.source || !t.goal) problems.push("missing // hard:, // source: or // goal: header");
  if (!/\binspect\s*=/.test(code) && !/function inspect\b/.test(code)) problems.push("no inspect()");
  let a = await execCode(wrapOriginal(t, code), t.runtimeEnv);
  let b = await execCode(wrapOriginal(t, code), t.runtimeEnv);
  if (a.threw) problems.push(`original throws: ${firstLine(a.value)}`);
  if (a.value !== b.value) problems.push(`nondeterministic: ${JSON.stringify(a.value)} vs ${JSON.stringify(b.value)}`);
  return { test: path.relative(HARD_DIR, file), value: a.value, problems };
}

function runInWorker(file, args) {
  return new Promise(resolve => {
    let child = childProcess.fork(SELF, ["--worker"], {
      env: Object.assign({}, process.env, { TZ: "UTC", LANG: "C", LC_ALL: "C" }),
      execArgv: ["--stack-size=10000", "--max-old-space-size=4096"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr.on("data", d => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    let done = false;
    let finish = r => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(r);
    };
    let rel = path.relative(HARD_DIR, file);
    let timer = setTimeout(
      () => finish({ test: rel, status: "CRASH", detail: `timeout after ${args.timeout}ms`, codes: ["TIMEOUT"] }),
      args.timeout
    );
    child.on("message", finish);
    child.on("exit", codeOrSignal =>
      finish({
        test: rel,
        status: "CRASH",
        detail: `worker died (${codeOrSignal}): ${firstLine(
          stderr
            .trim()
            .split("\n")
            .slice(-1)[0] || ""
        )}`,
        codes: ["WORKER_EXIT"],
      })
    );
    child.send({ file, prepack: args.prepack });
  });
}

async function pool(items, jobs, fn) {
  let results = new Array(items.length);
  let next = 0;
  let workers = new Array(Math.min(jobs, items.length)).fill(0).map(async () => {
    while (next < items.length) {
      let i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function folderOf(test) {
  return test.split(path.sep)[0];
}

function printTable(results) {
  let folders = [...new Set(results.map(r => folderOf(r.test)))];
  let rows = folders.map(f => {
    let rs = results.filter(r => folderOf(r.test) === f);
    return [f, rs.length, ...STATUSES.map(s => rs.filter(r => r.status === s).length)];
  });
  rows.push(["TOTAL", results.length, ...STATUSES.map(s => results.filter(r => r.status === s).length)]);
  let header = ["folder", "tests", ...STATUSES];
  let lines = [
    `| ${header.join(" | ")} |`,
    `|${header.map((h, i) => (i === 0 ? "---" : "---:")).join("|")}|`,
    ...rows.map(r => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

async function main() {
  let args = parseArgs(process.argv.slice(2));
  if (args.mode === "worker") {
    process.on("message", async msg => {
      let r;
      try {
        r = await runOne(msg.file, msg.prepack);
      } catch (e) {
        r = { test: path.relative(HARD_DIR, msg.file), status: "CRASH", detail: "harness: " + e.stack, codes: [] };
      }
      process.send(r, () => process.exit(0));
    });
    return;
  }
  if (args.mode === "exec") {
    let code = fs.readFileSync(0, "utf8");
    let r = await execInContext(code);
    process.stdout.write(JSON.stringify(r));
    process.exit(0);
  }
  let files = listTests(HARD_DIR).filter(f => path.relative(HARD_DIR, f).includes(args.filter));
  if (args.checkPlain) {
    let bad = 0;
    for (let f of files) {
      let r = await checkPlain(f);
      if (r.problems.length > 0) bad++;
      console.log(`${r.problems.length ? "BAD " : "ok  "} ${r.test}  => ${JSON.stringify(r.value.slice(0, 80))}`);
      for (let p of r.problems) console.log(`       ${p}`);
    }
    console.log(`${files.length - bad}/${files.length} tests run cleanly as plain JS`);
    process.exit(bad === 0 ? 0 : 1);
  }
  let version = "unknown";
  try {
    version = require(args.prepack).prepackVersion || version;
  } catch (e) {
    version = "failed to load: " + e.message;
  }
  console.log(`prepack: ${args.prepack} (${version}), ${files.length} tests, ${args.jobs} jobs`);
  let started = Date.now();
  let results = await pool(files, args.jobs, async f => {
    let r = await runInWorker(f, args);
    if (args.verbose || r.status !== "PASS") {
      let extra = r.recoveredOutput ? ` [recovered output ${r.recoveredOutput}]` : "";
      console.log(`${r.status.padEnd(5)} ${r.test}  ${r.detail || ""}${extra}`);
    }
    return r;
  });
  console.log("");
  console.log(printTable(results));
  console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (args.filter === "" || args.json !== path.join(HARD_DIR, "results.json")) {
    let summary = {};
    for (let s of STATUSES) summary[s] = results.filter(r => r.status === s).length;
    fs.writeFileSync(
      args.json,
      JSON.stringify(
        { prepack: args.prepack, version, node: process.version, date: new Date().toISOString(), summary, results },
        null,
        2
      ) + "\n"
    );
    console.log(`wrote ${path.relative(process.cwd(), args.json)}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
