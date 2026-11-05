/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// Prints generated programs. Usage:
//   node src/sample.js [--mode classic|extended] [--seed N] [--count N] [--run] [--prepack <lib>]
// With --run, each program is also run through Prepack and classified.

const { generate } = require("./generate");
const { divider } = require("./report");

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const mode = opt("--mode", "extended");
const seed = +opt("--seed", Math.floor(Math.random() * 1e9));
const count = +opt("--count", 3);
const run = argv.includes("--run");

console.log(divider);
for (let i = 0; i < count; i++) {
  const code = generate(mode, seed + i, { disable: (opt("--disable", "") || "").split(",").filter(Boolean) });
  console.log(`// mode ${mode}, seed ${seed + i}`);
  console.log(code);
  if (run) {
    const { runProgram } = require("./run");
    const r = runProgram(code, { prepack: opt("--prepack") });
    console.log(`// => ${r.status}${r.detail ? ": " + r.detail : ""}`);
    if (r.actual !== undefined && r.actual !== r.expected) {
      console.log(`// expected: ${JSON.stringify(r.expected)}\n// actual:   ${JSON.stringify(r.actual)}`);
    }
  }
  console.log(divider);
}
