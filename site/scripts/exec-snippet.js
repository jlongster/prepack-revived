// Runs one program the way a browser <script> would (sloppy, `this` === global),
// then evaluates a probe expression and prints the result as JSON.
// Usage: node exec-snippet.js job.json
"use strict";
const fs = require("fs");
const vm = require("vm");

const proc = process;
const job = JSON.parse(fs.readFileSync(proc.argv[2], "utf8"));
proc.on("unhandledRejection", () => {});

function fmt(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

let out;
try {
  if (job.prelude) vm.runInThisContext(job.prelude, { filename: "prelude.js" });
  vm.runInThisContext(job.code, { filename: job.filename || "program.js" });
  out = { ok: true, value: fmt(vm.runInThisContext(job.probe, { filename: "probe.js" })) };
} catch (e) {
  out = { ok: false, value: (e && e.name ? e.name + ": " + e.message : "throws " + fmt(e)).split("\n")[0] };
}
setImmediate(() => proc.stdout.write(JSON.stringify(out)));
