/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

const os = require("os");
const path = require("path");
const { resolvePrepack } = require("./run");
const { FEATURES } = require("./extended");

const USAGE = `usage: node src/fuzz.js [options]

  --time <seconds>       how long to generate and run programs (default 60; 0 = until Ctrl-C)
  --count <n>            stop after n programs instead (default: unlimited)
  --seed <n>             base seed; program i uses seed (base + i) (default: random)
  --mode classic|extended  generator (default extended); "both" alternates
  --prepack <path>       Prepack to test: lib dir, worktree root or prepack-node.js (default ../lib)
  --jobs <n>             worker processes (default: number of CPUs)
  --timeout <ms>         per-program timeout (default 20000)
  --out <dir>            where failures and the summary go (default fuzzer/out/<timestamp>)
  --minimize <seconds>   minimization budget per distinct failure after fuzzing (default 120; 0 = off)
  --max-minimize <n>     minimize at most n failures per class (default 25)
  --recover              recover from RecoverableErrors (like the CLI) and check the recovered output
  --invariant-level <n>  Prepack invariantLevel (default 0)
  --fatal-fails          count clean FatalErrors as failures too
  --disable <a,b,...>    extended mode: turn generator features off (e.g. to avoid a known bug):
                         ${FEATURES.join(", ")}
`;

function parseArgs(argv) {
  const a = {
    _: [],
    time: 60,
    count: Infinity,
    seed: undefined,
    mode: "extended",
    prepack: undefined,
    jobs: os.cpus().length,
    timeout: 20000,
    out: undefined,
    minimize: 120,
    maxMinimize: 25,
    recover: false,
    invariantLevel: 0,
    fatalFails: false,
    disable: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case "--time":
        a.time = +next();
        break;
      case "--count":
        a.count = +next();
        break;
      case "--seed":
        a.seed = +next();
        break;
      case "--mode":
        a.mode = next();
        break;
      case "--prepack":
        a.prepack = next();
        break;
      case "--jobs":
        a.jobs = +next();
        break;
      case "--timeout":
        a.timeout = +next();
        break;
      case "--out":
        a.out = next();
        break;
      case "--minimize":
        a.minimize = +next();
        break;
      case "--max-minimize":
        a.maxMinimize = +next();
        break;
      case "--recover":
        a.recover = true;
        break;
      case "--invariant-level":
        a.invariantLevel = +next();
        break;
      case "--disable":
        a.disable = next()
          .split(",")
          .filter(Boolean);
        for (const f of a.disable) if (!FEATURES.includes(f)) throw new Error(`unknown feature ${f}`);
        break;
      case "--fatal-fails":
        a.fatalFails = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown option ${arg}\n${USAGE}`);
        a._.push(arg);
    }
  }
  if (!["classic", "extended", "both"].includes(a.mode)) throw new Error(`bad --mode ${a.mode}`);
  a.prepack = resolvePrepack(a.prepack);
  a.runOptions = { prepack: a.prepack, recover: a.recover, invariantLevel: a.invariantLevel, disable: a.disable };
  if (a.seed === undefined) a.seed = Math.floor(Math.random() * 1e9);
  if (!a.out) a.out = path.resolve(__dirname, "..", "out", new Date().toISOString().replace(/[:.]/g, "-"));
  return a;
}

module.exports = { parseArgs, USAGE };
