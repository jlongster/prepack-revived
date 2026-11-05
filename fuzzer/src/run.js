/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// Runs one program through the oracle (plain Node, in a fresh vm context) and
// through Prepack, then classifies the outcome:
//
//   pass       residual inspect() output equals the original's
//   wrong      Prepack reported success but the residual computes something else
//              (or throws while loading)
//   invariant  Prepack threw an Invariant Violation
//   crash      Prepack threw some other internal exception (TypeError, ...)
//   fatal      Prepack bailed out cleanly with a FatalError / error diagnostic (not a failure)
//   invalid    the program itself throws or does not terminate in plain Node (generator bug)
//
// With `recover: true`, recoverable errors are recovered from (as the CLI does) and the
// recovered output is checked too; a wrong recovered output is classified `wrong-recovered`.

const path = require("path");
const vm = require("vm");

const EXEC_TIMEOUT = 4000;

function execute(code) {
  let result;
  try {
    new vm.Script(`var global = this;\nvar self = this;\n${code}\nreport(inspect());`).runInNewContext(
      {
        report: s => {
          result = s;
        },
      },
      { timeout: EXEC_TIMEOUT }
    );
  } catch (e) {
    const timeout = e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
    return { threw: true, timeout, value: String(e && e.stack ? e.stack : e).split("\n")[0] };
  }
  return { threw: false, value: String(result) };
}

let loaded = new Map();
function loadPrepack(prepackPath) {
  let p = resolvePrepack(prepackPath);
  if (!loaded.has(p)) loaded.set(p, require(p));
  return loaded.get(p);
}

function resolvePrepack(p) {
  if (!p) p = path.resolve(__dirname, "..", "..", "lib", "prepack-node.js");
  p = path.resolve(p);
  const fs = require("fs");
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    for (const c of ["prepack-node.js", "lib/prepack-node.js"]) {
      if (fs.existsSync(path.join(p, c))) return path.join(p, c);
    }
  }
  return p;
}

function runProgram(code, opts = {}) {
  const expected = execute(code);
  if (expected.threw) return { status: "invalid", detail: expected.value, expected: expected.value };
  if (opts.checkDeterminism) {
    const again = execute(code);
    if (again.value !== expected.value) return { status: "invalid", detail: "nondeterministic oracle" };
  }
  const prepack = loadPrepack(opts.prepack);
  const diags = [];
  const options = {
    serialize: true,
    uniqueSuffix: "",
    internalDebug: true,
    invariantLevel: opts.invariantLevel === undefined ? 0 : opts.invariantLevel,
    errorHandler: d => {
      diags.push(d);
      if (d.severity === "Information" || d.severity === "Warning") return "Recover";
      if (opts.recover && d.severity === "RecoverableError") return "Recover";
      return "Fail";
    },
  };
  let serialized, exception;
  const started = Date.now();
  try {
    serialized = prepack.prepackSources([{ filePath: "fuzz.js", fileContents: code, sourceMapContents: "" }], options);
  } catch (e) {
    exception = e;
  }
  const prepackMs = Date.now() - started;
  const errors = diags.filter(d => d.severity === "FatalError" || d.severity === "RecoverableError");
  const codes = [...new Set(errors.map(d => d.errorCode))];
  const base = { expected: expected.value, codes, prepackMs };

  if (exception !== undefined) {
    const name = exception && exception.constructor ? exception.constructor.name : typeof exception;
    const stack = String((exception && exception.stack) || exception);
    if (name === "InvariantError" || (exception && exception.name === "Invariant Violation")) {
      const frames = topFrames(stack).split("\n");
      const where = (frames.find(f => !/at invariant /.test(f)) || "").replace(/^at /, "");
      const detail = firstLine(exception.message).trim() || `(no message) at ${where.replace(/:\d+\)?$/, "")}`;
      return Object.assign(base, { status: "invariant", detail, stack: frames.join("\n") });
    }
    if (name === "FatalError" || name === "CompilerDiagnostic") {
      // A FatalError may wrap an internal failure that was reported as a diagnostic.
      const internal = errors.find(d => /Invariant Violation|internal error/i.test(String(d.message)));
      if (internal && /Invariant Violation/.test(String(internal.message))) {
        return Object.assign(base, { status: "invariant", detail: firstLine(internal.message) });
      }
      const detail = errors.length
        ? `${errors[0].errorCode}: ${firstLine(errors[0].message)}`
        : `FatalError: ${firstLine(exception.message)}`;
      return Object.assign(base, { status: "fatal", detail });
    }
    return Object.assign(base, {
      status: "crash",
      detail: `${(exception && exception.name) || name}: ${firstLine(exception && exception.message)}`,
      stack: topFrames(stack),
    });
  }

  const actual = execute(serialized.code);
  Object.assign(base, { actual: actual.value, output: serialized.code });
  if (actual.timeout) {
    return Object.assign(base, { status: "timeout", detail: "residual execution timed out" });
  }
  if (errors.length > 0) {
    // Only reachable with `recover`.
    const detail = `${errors[0].errorCode}: ${firstLine(errors[0].message)}`;
    if (actual.value !== expected.value) return Object.assign(base, { status: "wrong-recovered", detail });
    return Object.assign(base, { status: "fatal", detail, recovered: true });
  }
  if (actual.value !== expected.value) {
    return Object.assign(base, { status: "wrong", detail: actual.threw ? "residual throws: " + actual.value : "" });
  }
  return Object.assign(base, { status: "pass" });
}

const FAILURES = new Set(["wrong", "wrong-recovered", "invariant", "crash"]);

function firstLine(s) {
  return String(s)
    .split("\n")[0]
    .slice(0, 300);
}

function topFrames(stack) {
  return stack
    .split("\n")
    .filter(l => /^\s+at /.test(l))
    .slice(0, 6)
    .map(l => l.trim().replace(/(\(|at )\/.*\/(lib|src)\//, "$1$2/"))
    .join("\n");
}

module.exports = { execute, runProgram, resolvePrepack, FAILURES };
