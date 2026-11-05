"use strict";
// node react-ssr/test/run.js: specializes features-app.js and the react-bench app, and compares
// the output with ReactDOMServer.renderToString on random data, including data outside the schema
// (which must fall back).
const fs = require("fs");
const path = require("path");
const ssr = require("../compiler.js");
const BENCH = "/tmp/opencode/pp-wt/react-bench/react-bench";
const { React, ReactDOMServer, reactRequire } = require(BENCH + "/react-deps");

function load(source) {
  const m = { exports: {} };
  new Function("module", "exports", "require", source)(m, m.exports, reactRequire);
  return m.exports;
}

let seed = 7;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = xs => xs[Math.floor(rnd() * xs.length)];
const STR = ["", "plain", "a<b>&'\"c", "  spaced  ", "ü 漢字 🚀", "javascript:alert(1)", "\nnewline"];
function featuresData() {
  const n = Math.floor(rnd() * 4);
  const items = [];
  for (let i = 0; i < n; i++) items.push({ name: pick(STR), qty: pick([0, 1, 2, 7.5, -3]), note: pick([undefined, "", "fragile & <hot>"]) });
  const tags = [];
  for (let i = 0, m = Math.floor(rnd() * 3); i < m; i++) tags.push("t" + i + pick(["", "<x>"]));
  return {
    theme: pick(["light", "dark & dim"]),
    title: pick(STR),
    open: pick([true, false]),
    items,
    size: pick([12, 0, 1.5, "2em", undefined]),
    accent: pick(["red", " blue ", undefined]),
    message: pick(STR),
    sizeCode: pick(["s", "m", "x"]),
    img: pick(["/a.png", "x\"y.png"]),
    alt: pick(STR),
    tags,
    disabledTag: pick(["t0", "t1", "none"]),
    footer: pick(STR.concat([null, 42])),
  };
}

function check(name, source, makeData, samples, extra) {
  const App = load(source);
  const reference = d => ReactDOMServer.renderToString(React.createElement(App, { data: d }));
  const t0 = Date.now();
  const result = ssr.compile(source, { samples, fallback: reference });
  let ok = 0;
  let failures = 0;
  const inputs = [];
  for (let i = 0; i < 300; i++) inputs.push(makeData());
  for (const d of inputs.concat(extra)) {
    const attempt = f => {
      try {
        return f(d);
      } catch (e) {
        return "THROWS " + e.message;
      }
    };
    const expected = attempt(reference);
    const actual = attempt(result.render);
    if (expected === actual) ok++;
    else {
      failures++;
      if (failures <= 3) {
        let k = 0;
        while (expected[k] === actual[k]) k++;
        console.log("  MISMATCH", JSON.stringify(expected.slice(k - 40, k + 40)), "\n       got", JSON.stringify(actual.slice(k - 40, k + 40)));
      }
    }
  }
  console.log(
    `${name}: ${ok}/${inputs.length + extra.length} identical, ${result.render.fallbacks} fell back; compile ${Date.now() - t0} ms, ${result.code.length} bytes`
  );
  return failures === 0;
}

const featuresSource = fs.readFileSync(path.join(__dirname, "features-app.js"), "utf8");
const samples = [];
for (let i = 0; i < 200; i++) samples.push(featuresData());
const outside = [
  Object.assign(featuresData(), { title: 17 }),
  Object.assign(featuresData(), { items: [{ name: "x", qty: "3" }] }),
  Object.assign(featuresData(), { tags: "notanarray" }),
];
let pass = check("features", featuresSource, featuresData, samples, outside);

if (process.argv.includes("--bench")) {
  const data = require(BENCH + "/data.js");
  const benchSource = fs.readFileSync(BENCH + "/app/app.js", "utf8");
  const training = data.getTrainingCorpus
    ? data.getTrainingCorpus(300, "small").concat(data.getTrainingCorpus(30, "large"))
    : Array.from({ length: 330 }, (_, i) => data.generateRequest(5000 + i, i < 300 ? "small" : "large"));
  const corpus = data.getCheckCorpus();
  let next = 0;
  const benchOutside = [
    Object.assign({}, corpus[5], { user: { id: 1, name: "x" } }),
    Object.assign({}, corpus[6], { products: [Object.assign({}, corpus[6].products[0] || {}, { price: "12" })] }),
  ];
  pass = check("react-bench app", benchSource, () => corpus[next++ % corpus.length], training, benchOutside) && pass;
}
process.exit(pass ? 0 : 1);
