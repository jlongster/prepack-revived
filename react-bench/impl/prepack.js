"use strict";

// react-bench implementation: React SSR specialized by the revived Prepack (react-ssr/compiler.js).
// prepare() runs Prepack once per app source and caches the generated program on disk (keyed by a
// hash of the app source, the schema samples and the compiler/model sources), so later processes
// only load the artifact. The generated program does not use React.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SSR_DIR = path.join(ROOT, "react-ssr");
const CACHE_DIR = process.env.REACT_SSR_CACHE || path.join(os.tmpdir(), "react-ssr-cache");
const TRAINING_SMALL = 400;
const TRAINING_LARGE = 40;

function trainingSamples(opts) {
  if (typeof opts.trainingInputs === "function") {
    return opts.trainingInputs(TRAINING_SMALL, "small").concat(opts.trainingInputs(TRAINING_LARGE, "large"));
  }
  const samples = [];
  for (let i = 0; i < TRAINING_SMALL + TRAINING_LARGE; i++) {
    samples.push(opts.generateSampleInput(900000 + i, i < TRAINING_SMALL ? "small" : "large"));
  }
  return samples;
}

function cacheKey(appSource, schema) {
  const hash = crypto.createHash("sha256");
  hash.update(appSource);
  hash.update(JSON.stringify(schema));
  for (const f of ["compiler.js", "runtime.js", "helpers.js", "dom-tables.part.js"]) {
    hash.update(fs.readFileSync(path.join(SSR_DIR, f)));
  }
  const prepackLib = path.join(ROOT, "lib");
  for (const f of fs.readdirSync(prepackLib, { recursive: true }).sort()) {
    if (typeof f === "string" && f.endsWith(".js")) hash.update(fs.statSync(path.join(prepackLib, f)).mtimeMs + f);
  }
  return hash.digest("hex").slice(0, 24);
}

function instantiate(code) {
  const sandbox = Object.create(globalThis);
  new Function(code).call(sandbox);
  return sandbox.__ssrRender;
}

module.exports = {
  name: "prepack (react-ssr specialization)",
  prepare(appSource, opts = {}) {
    const compiler = require(path.join(SSR_DIR, "compiler.js"));
    const rootProp = opts.rootProp || "data";
    const schemaFile = path.join(CACHE_DIR, "schema-" + crypto.createHash("sha256").update(appSource).digest("hex").slice(0, 16) + ".json");
    let schema;
    if (fs.existsSync(schemaFile)) schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
    else schema = compiler.inferSchema(trainingSamples(opts));
    const key = cacheKey(appSource, schema);
    const artifact = path.join(CACHE_DIR, "render-" + key + ".js");
    let code;
    let stats = { cached: true };
    if (fs.existsSync(artifact)) {
      code = fs.readFileSync(artifact, "utf8");
    } else {
      const result = compiler.compile(appSource, { schema, rootProp });
      code = result.code;
      stats = Object.assign({ cached: false }, result.stats);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(schemaFile, JSON.stringify(schema));
      fs.writeFileSync(artifact + ".tmp" + process.pid, code);
      fs.renameSync(artifact + ".tmp" + process.pid, artifact);
    }
    const render = instantiate(code);
    if (typeof render !== "function") throw new Error("react-ssr: artifact did not define __ssrRender");
    return { render, code, stats };
  },
};
