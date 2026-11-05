# react-bench: specialize React SSR for a known app with unknown data

Shared benchmark for comparing React SSR specializers (Prepack's React compiler revival, the
trace-based "hybrid", hand-written templates) against plain `ReactDOMServer.renderToString`.

(Work in progress — full docs below are filled in as the harness grows.)

## Implementation interface

An implementation is a CommonJS module:

```js
module.exports = {
  name: "my-impl",
  // appSource: contents of react-bench/app/app.js (plain CommonJS: require("react"), module.exports = App)
  // opts: see below. Called once; may be slow (compilation happens here).
  prepare(appSource, opts) {
    return function render(data) { return "<div ...>" }; // must equal renderToString(<App data={data}/>)
  },
};
```

`prepare` may return either the render function or `{ render, code, stats }`. For the code-size
report the harness uses, in order: `result.code` / `result.generatedCode` / `render.code` /
`render.generatedCode` (a string with your generated program — **please set it**), else
`render.toString()`. `stats` (any JSON) is printed in the JSON report.

`opts` contains: `appPath`, `jsxPath`, `reactBenchDir`, `reactNodeModules` (dir with react@18.3.1),
`require` (a require function resolving react 18), `React`, `ReactDOMServer`, `rootProp: "data"`,
`generateSampleInput(seed, "small"|"large")` (to produce training/trace inputs; do **not** use the
check corpus itself for training).

Rules: the render function gets a fresh deep copy of the input each call; it must be pure
(no reliance on call order), must not mutate input, and must produce byte-identical output
(including `<!-- -->` text separators and `useId` ids like `:R1d:`).

## Commands

```
node react-bench/check.js --impl baseline          # or impl/handwritten, or a path to your module
node react-bench/check.js --impl /abs/path/impl.js --only small --limit 50 --json out.json
node react-bench/build-app.js                      # recompile app/app.jsx -> app/app.js
```
