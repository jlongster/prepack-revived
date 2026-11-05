/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

const MODES = ["classic", "extended"];

function generate(mode, seed, options = {}) {
  if (mode === "classic") return require("./classic").generateClassic(seed);
  if (mode === "extended") return require("./extended").generateExtended(seed, { disable: options.disable });
  throw new Error(`unknown mode ${mode} (expected ${MODES.join(" or ")})`);
}

module.exports = { generate, MODES };
