// Examples shown on the page. `node site/scripts/run-examples.js` runs each input through
// the tools listed in `tools` and evaluates every probe against the original program and
// against each tool's output, so "wrong result" claims on the page are measured, not asserted.
//
// Abstract inputs use __abstract(type, "name"): Prepack keeps them as the free variable
// `name`, which the probe prelude then defines for the run.
"use strict";

const P = (label, prelude, probe, env) => ({ label, prelude, probe, env });

module.exports = [
  { id: "intro-hello", input: "intro-hello.js", tools: ["orig"], probes: [P("s", "", "s")] },
  {
    id: "intro-partial",
    input: "intro-partial.js",
    tools: ["orig"],
    probes: [P("banner", "", "banner")],
  },
  {
    id: "loops-1174",
    input: "loops-1174.js",
    probes: [P("sum(0), sum(5), sum(10)", "", "[sum(0), sum(5), sum(10)].join()")],
  },
  {
    id: "loops-1722",
    input: "loops-1722.js",
    probes: [P("n0 = 5", "var n0 = 5;", "JSON.stringify(result) + ' i=' + i")],
  },
  {
    id: "loops-2055",
    input: "loops-2055.js",
    probes: [
      P(
        'fn({text:"ab\\n\\ncd"}, 4), fn({}, null), fn({text:"a\\n\\n\\nb"}, 4)',
        "",
        '[fn({ text: "ab\\n\\ncd" }, 4), fn({}, null), fn({ text: "a\\n\\n\\nb" }, 4)]'
      ),
    ],
  },
  {
    id: "recursion-fib",
    input: "recursion-fib.js",
    timeout: 60000,
    probes: [P("f(7), f(12)", "", "[f(7), f(12)].join()")],
  },
  {
    id: "recursion-fact",
    input: "recursion-fact.js",
    probes: [P("k0 = 6", "var k0 = 6;", "r")],
  },
  {
    id: "joins-2354",
    input: "joins-2354.js",
    probes: [
      P("main(false, false, false)", "", "main(false, false, false)"),
      P('main(0, "", NaN)', "", 'main(0, "", NaN)'),
    ],
  },
  {
    id: "joins-2355",
    input: "joins-2355.js",
    probes: [P('[1, 0, "", "x", null, NaN].map(main)', "", '[1, 0, "", "x", null, NaN].map(main)')],
  },
  {
    id: "joins-labeled",
    input: "joins-labeled.js",
    probes: [P("f(true, true), f(false, true), f(false, false)", "", "[f(true, true), f(false, true), f(false, false)].join()")],
  },
  {
    id: "joins-switch-1378",
    input: "joins-switch-1378.js",
    probes: [P('[0, 1, 2, 3, 4, 5, "1"].map(weight)', "", '[0, 1, 2, 3, 4, 5, "1"].map(weight)')],
  },
  {
    id: "joins-try-2120",
    input: "joins-try-2120.js",
    probes: [
      P(
        "f(() => 1), f(() => { throw 0 })",
        "",
        "[f(function () { return 1; }), f(function () { throw new Error('x'); })].join()"
      ),
    ],
  },
  {
    id: "ranges-1066",
    input: "ranges-1066.js",
    probes: [P("x0 = true", "var x0 = true;", "a.join() + ' | length ' + a.length"), P("x0 = false", "var x0 = false;", "a.join() + ' | length ' + a.length")],
  },
  {
    id: "builtins-2319",
    input: "builtins-2319.js",
    probes: [P('classify("abc", "10"), classify("A1", "12px")', "", '[classify("abc", "10"), classify("A1", "12px")].join()')],
  },
  {
    id: "havoc-1750",
    input: "havoc-1750.js",
    probes: [P('getEntry("a") ×2, getEntry("b"), getEntry("a")', "", '[getEntry("a"), getEntry("a"), getEntry("b"), getEntry("a")].join()')],
  },
  {
    id: "paths-negation",
    input: "paths-negation.js",
    probes: [P('[0, "", false, NaN, null, 1].map(main)', "", '[0, "", false, NaN, null, 1].map(main)')],
  },
  {
    id: "env-window",
    input: "env-window.js",
    probes: [P("in a browser (window === this, fetch defined)", "var window = this; this.fetch = function () {};", "api")],
  },
  {
    id: "env-process",
    input: "env-process.js",
    probes: [
      P(
        'in Node with NODE_ENV=production, DEBUG=1',
        'globalThis.process = { env: { NODE_ENV: "production", DEBUG: "1" } };',
        "config"
      ),
    ],
  },
  {
    id: "env-guard",
    input: "env-guard.js",
    tools: ["revived"],
    args: { revived: ["--assume", 'process.env.NODE_ENV="production"', "--assume", "timezoneOffset=0"] },
    probes: [
      P("NODE_ENV=production, TZ=UTC", 'globalThis.process = { env: { NODE_ENV: "production" } };', "[mode, newYear, offset].join()", { TZ: "UTC" }),
      P(
        "NODE_ENV=development, TZ=Asia/Kolkata",
        'globalThis.process = { env: { NODE_ENV: "development" } };',
        "[mode, newYear, offset].join()",
        { TZ: "Asia/Kolkata" }
      ),
    ],
  },
  {
    id: "hyb-closures",
    input: "hyb-closures.js",
    tools: ["orig", "revived", "hybrid"],
    probes: [P("counter.inc(), counter.history()", "", "[counter.inc(), counter.history()].join(' / ')")],
  },
  {
    id: "hyb-class",
    input: "hyb-class.js",
    tools: ["orig", "revived", "hybrid"],
    probes: [P('lex("let x"), lex("abc")', "", '[lex("let x"), lex("abc")].join()')],
  },
  {
    id: "hyb-tables",
    input: "hyb-tables.js",
    tools: ["orig", "revived", "hybrid"],
    probes: [
      P(
        'crc("hello"), views[2][7], views share one buffer',
        "",
        '[crc("hello").toString(16), views[2][7], views[0].buffer === views[2].buffer && views[2].byteOffset].join()'
      ),
    ],
  },
  {
    id: "hyb-handlebars",
    input: "hyb-handlebars.js",
    tools: ["orig", "revived", "hybrid"],
    probes: [P("HandlebarsMini", "", 'HandlebarsMini.VERSION + " " + HandlebarsMini.escapeExpression("a&<b>")')],
  },
  {
    id: "hyb-guard",
    input: "hyb-guard.js",
    tools: ["hybrid"],
    probes: [
      P("browser-like host (window, no process)", "delete globalThis.process; globalThis.window = globalThis;", "Settings"),
      P("Node (process present)", "", "Settings"),
    ],
  },
  {
    id: "size-table",
    input: "size-table.js",
    probes: [P("table.length, sum", "", "table.length + ' entries, sum ' + table.reduce(function (a, b) { return a + b; }, 0)")],
  },
  {
    id: "size-error",
    input: "size-error.js",
    probes: [
      P(
        "what check() throws",
        "",
        "(function () { try { check(0); } catch (e) { return Object.prototype.toString.call(e) + ' ' + e.message + ' instanceof TypeError: ' + (e instanceof TypeError); } })()"
      ),
    ],
  },
];
