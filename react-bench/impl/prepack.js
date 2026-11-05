"use strict";

// react-bench implementation: React SSR specialized by the revived Prepack (react-ssr/compiler.js).
// prepare() runs Prepack once per app source and caches the generated program on disk (keyed by a
// hash of the app source, the schema and the compiler/model/Prepack sources), so later processes
// only load the artifact. The generated program does not use React. It checks that the data has
// the schema inferred from the training inputs; data that does not falls back to
// ReactDOMServer.renderToString (React is only loaded then).

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

function sha(...parts) {
  const hash = crypto.createHash("sha256");
  for (const p of parts) hash.update(p);
  return hash.digest("hex").slice(0, 24);
}

function cacheKey(appSource, schema) {
  const parts = [appSource, JSON.stringify(schema)];
  for (const f of ["compiler.js", "instantiate.js", "runtime.js", "helpers.js", "dom-tables.part.js"]) {
    parts.push(fs.readFileSync(path.join(SSR_DIR, f)));
  }
  // `yarn build-prepack` rewrites every file of lib/, so one of them stands for the build.
  parts.push(String(fs.statSync(path.join(ROOT, "lib", "prepack-node.js")).mtimeMs));
  return sha(...parts);
}

function reactFallback(appSource, opts) {
  let render;
  return data => {
    if (render === undefined) {
      const req = opts.require || require;
      const React = opts.React || req("react");
      const ReactDOMServer = opts.ReactDOMServer || req("react-dom/server");
      const mod = { exports: {} };
      new Function("module", "exports", "require", appSource)(mod, mod.exports, req);
      render = d => ReactDOMServer.renderToString(React.createElement(mod.exports, { [opts.rootProp || "data"]: d }));
    }
    return render(data);
  };
}

module.exports = {
  name: "prepack (react-ssr specialization)",
  prepare(appSource, opts = {}) {
    const schemaFile = path.join(CACHE_DIR, "schema-" + sha(appSource) + ".json");
    const schema = fs.existsSync(schemaFile)
      ? JSON.parse(fs.readFileSync(schemaFile, "utf8"))
      : require(path.join(SSR_DIR, "compiler.js")).inferSchema(trainingSamples(opts));
    const artifact = path.join(CACHE_DIR, "render-" + cacheKey(appSource, schema) + ".js");
    const fallback = reactFallback(appSource, opts);
    if (fs.existsSync(artifact)) {
      const code = fs.readFileSync(artifact, "utf8");
      const render = require(path.join(SSR_DIR, "instantiate.js")).instantiate(code, fallback);
      return { render, code, stats: { cached: true, fallback: "ReactDOMServer.renderToString (not counted in code size)" } };
    }
    const result = require(path.join(SSR_DIR, "compiler.js")).compile(appSource, { schema, rootProp: opts.rootProp || "data", fallback });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(schemaFile, JSON.stringify(schema));
    const tmp = artifact + ".tmp" + process.pid;
    fs.writeFileSync(tmp, result.code);
    fs.renameSync(tmp, artifact);
    return { render: result.render, code: result.code, stats: Object.assign({ cached: false }, result.stats) };
  },
};
