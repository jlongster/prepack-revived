/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// Worker process: receives {id, mode, seed} (generate and run) or {id, code}
// (run given code) over IPC and replies with the classification from run.js.
// The parent enforces timeouts by killing the worker.

const { runProgram, FAILURES } = require("./run");
const { generate } = require("./generate");

const options = JSON.parse(process.env.FUZZ_OPTIONS || "{}");

process.on("message", task => {
  let code = task.code;
  let result;
  try {
    if (code === undefined) code = generate(task.mode, task.seed, options);
    result = runProgram(code, options);
  } catch (e) {
    result = { status: "harness-error", detail: String((e && e.stack) || e) };
  }
  // Keep IPC messages small: only failures carry the program and output.
  if (!task.full && !FAILURES.has(result.status)) {
    delete result.output;
    delete result.stack;
  } else {
    result.code = code;
  }
  process.send({ id: task.id, result });
});
process.send({ ready: true });
