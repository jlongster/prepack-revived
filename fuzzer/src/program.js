/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// Shared shape of every fuzzer program, in the format of the hard corpus
// (test/serializer/hard/README.md): an IIFE that defines `main`, optimizes it
// with __optimize and exposes it as global.main, plus a global inspect() that
// calls main on several concrete argument tuples and formats the results
// (including thrown values) into one deterministic string.

const FNS = [
  "function (x) { return x; }",
  "function (x) { return typeof x; }",
  "function (x, y) { return x + y; }",
  'function () { throw new Error("F"); }',
  "function (x) { return !x; }",
  'function (x) { if (x && typeof x === "object") { x.m = 1; } return 7; }',
];

function emitProgram({ helpers, main, tuples }) {
  return `(function () {
  "use strict";
${indent(helpers.join("\n"), 2)}
${indent(main, 2)}
  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function () {
  function fmt(v, d) {
    if (v === null) return "null";
    var t = typeof v;
    if (t === "number") return v === 0 && 1 / v < 0 ? "-0" : String(v);
    if (t === "string") return JSON.stringify(v);
    if (t === "function") return "fn";
    if (t !== "object") return String(v);
    if (v instanceof Error) return v.name === "Error" ? "Error(" + v.message + ")" : v.name;
    if (d > 3) return "...";
    if (Array.isArray(v)) return "[" + v.map(function (x) { return fmt(x, d + 1); }).join(",") + "]";
    return "{" + Object.keys(v).map(function (k) { return k + ":" + fmt(v[k], d + 1); }).join(",") + "}";
  }
  var fns = [
${FNS.map(f => "    " + f).join(",\n")}
  ];
  var args = [
${tuples.map(t => "    [" + t.join(", ") + "]").join(",\n")}
  ];
  var out = [];
  for (var i = 0; i < args.length; i++) {
    try {
      out.push(fmt(main.apply(null, args[i]), 0));
    } catch (e) {
      out.push("throw " + fmt(e, 0));
    }
  }
  return out.join("\\n");
};
`;
}

function indent(s, n) {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map(l => (l.length ? pad + l : l))
    .join("\n");
}

module.exports = { emitProgram, FNS, indent };
