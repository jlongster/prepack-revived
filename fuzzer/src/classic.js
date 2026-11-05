/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// The "classic" generator: Caleb Meredith's original testcheck generator
// (gen.js: scalars, ifs, conditionals and functions), wrapped into the shared
// program shape. testcheck's sampleOne uses a global PRNG seeded at load time,
// so we generate through check() with an explicit seed and a fixed size instead,
// which makes generation reproducible from (seed).

const generate = require("@babel/generator").default;
const { check, property, gen } = require("testcheck");
const { genProgramStatements } = require("./gen");
const { emitProgram } = require("./program");
const { mulberry32 } = require("./extended");

function generateClassic(seed) {
  const r = mulberry32(seed)();
  const size = 5 + Math.floor(r * r * 150);
  let statements;
  check(
    property(gen.sized(() => genProgramStatements.scale(() => size)), s => {
      statements = s;
      return true;
    }),
    { numTests: 1, seed }
  );
  // statements: "use strict", helper declarations, main, if (__optimize), module.exports = inspect.
  const helpers = statements.slice(1, -3).map(s => generate(s).code);
  const main = generate(statements[statements.length - 3]).code;
  const inspect = statements[statements.length - 1].expression.right;
  const args = inspect.body.body[0].argument.arguments.map(a => generate(a).code);
  return emitProgram({ helpers, main, tuples: [args] });
}

module.exports = { generateClassic };
