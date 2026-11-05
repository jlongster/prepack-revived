// The freezedry post: a shorter standalone article in the same visual system.
"use strict";
const fs = require("fs");
const path = require("path");

const PREPACK_POST = "https://jamesbox.exe.xyz/artifacts/prepack-revived/";
const REPO = "https://github.com/jlongster/freezedry";

module.exports = (c, render) => {
  const { example, note, pipeline, react, code, esc, examples } = c;
  const results = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/freezedry-results.json"), "utf8"));
  const W = Object.fromEntries(results.workloads.map(w => [w.id, w]));
  const verified = results.workloads.filter(w => /ISO-OK/.test(w.optIns)).length;
  const verifiedZero = results.workloads.filter(w => /ISO-OK/.test(w.zeroConfig)).length;
  const fx = (id, opts) => example(id, Object.assign({ tools: ["hybrid"] }, opts));

  const bailRows = [
    ["fd-fetch", "a network request"],
    ["fd-dom", "touching the DOM"],
    ["fd-timer", "scheduling a timer"],
    ["fd-now", "reading the clock"],
    ["fd-random", "randomness"],
    ["fd-tz", "the local time zone"],
  ]
    .map(([id, what]) => {
      const ex = examples[id];
      const reason = ex.tools.hybrid.stderr.split("\n")[0].replace(/^\[[^\]]+\] bailout \(emitting fallback\): /, "");
      return `<tr><th scope="row">${what}</th><td><code>${esc(ex.input.trim())}</code></td><td>${esc(reason)}</td></tr>`;
    })
    .join("");

  const STATUS = s =>
    /ISO-OK†/.test(s) ? "Verified†" : /ISO-OK/.test(s) ? "Verified" : /UNVERIFIED/.test(s) ? "Runs; not verified" : /BAIL/.test(s) ? "Bails out" : s;
  const x = v => (v == null ? "–" : v.toFixed(2) + "×");
  const resultRows = results.workloads
    .map(w => {
      const p = w.perf || {};
      const g = p.gzipKB && p.gzipOrigKB ? p.gzipKB / p.gzipOrigKB : null;
      const gr = w.gzipThrowKB && p.gzipOrigKB ? w.gzipThrowKB / p.gzipOrigKB : null;
      const cls = s => (/Verified/.test(STATUS(s)) ? "" : ' class="muted"');
      return `<tr><th scope="row">${esc(w.id)}</th><td${cls(w.zeroConfig)}>${STATUS(w.zeroConfig)}</td><td${cls(w.optIns)}>${STATUS(
        w.optIns
      )}</td><td class="num">${x(g)}</td><td class="num">${x(gr)}</td><td class="num">${x(p.codeCacheSpeedup)}</td><td class="num">${
        p.coldOrigMs >= 5 ? x(p.coldSpeedup) : '<span class="muted">under 5 ms</span>'
      }</td></tr>`;
    })
    .join("");

  const parts = [
    {
      id: "what",
      num: "1",
      label: "Section 1",
      title: "Freeze the heap, not the code",
      short: "What it is",
      deck: "Most bundles spend their first milliseconds building the same objects every time. freezedry runs that work once, in the real engine, and ships the result.",
      body: `
<p class="lede">A JavaScript bundle’s initialization is deterministic surprisingly often: modules register
themselves, lookup tables are computed, classes and closures are wired together. freezedry runs that initialization at
build time inside V8, captures the heap it leaves behind (objects, closures and the scopes they share), and writes
JavaScript that rebuilds that heap directly. Anything the build machine can’t know becomes a runtime guard, and when a
guard fails the original code runs instead.</p>

<div class="wn"><div class="b">
<p>The idea is old: it is what Facebook’s Prepack set out to do in 2017. Prepack, though, evaluated your code with
its own interpreter, about 35,000 of its 81,000 lines a re-implementation of the ECMAScript spec, and real libraries
kept finding the gaps: a missing <code>globalThis</code>, a class feature, an Annex B corner. freezedry has no
interpreter. V8 runs the code, so the semantics are exact by construction and every syntax the engine supports works.
The work moves to two places: capturing what initialization built, and being honest about what can’t be captured.</p>
</div>${note(`freezedry grew out of an experiment in <a href="${PREPACK_POST}">reviving Prepack</a>.`)}</div>

<p>Here is the smallest interesting case: three closures over one scope, with state that changed during
initialization. A heap snapshot written as JavaScript has to recreate the scope as a real scope, shared by all
three functions, with the <code>count</code> it had at the end:</p>

${fx("closures", { caption: "Every output on this page is the verbatim output of freezedry for the input next to it. The table under each one runs the original program and the output in fresh Node processes and compares the results." })}
`,
    },
    {
      id: "how",
      num: "2",
      label: "Section 2",
      title: "How it works",
      short: "How it works",
      deck: "Run, capture, emit, guard, verify. Everything uses Node’s built-in vm, inspector and v8 modules.",
      body: `
<figure class="w chart">
${pipeline([
  { title: "Run", lines: ["init code in a fresh, sealed", "vm context; record every", "read of the environment"] },
  { title: "Capture", lines: ["walk the heap via the", "inspector: [[Scopes]] and", "heap-snapshot contexts"] },
  { title: "Emit", lines: ["JavaScript that rebuilds", "objects, closures and", "their shared scopes"] },
  { title: "Guard", lines: ["recorded assumptions become", "a runtime check; on mismatch", "the original code runs"] },
  { title: "Verify", lines: ["run both in fresh contexts;", "compare the heaps object", "by object, scope by scope"] },
])}
<figcaption>The freezedry pipeline.</figcaption>
</figure>

<div class="wn"><div class="b">
<p><strong>Run.</strong> The input runs in a fresh V8 context created with <code>vm.constants.DONT_CONTEXTIFY</code>,
so <code>this</code> is a genuine global object with no interceptors in the way. A membrane sits between that global
object and its prototype, so every read of a global that isn’t plain ECMAScript (<code>window</code>,
<code>process</code>, <code>localStorage</code>) goes through freezedry first.</p>

<p><strong>Capture.</strong> JavaScript can’t see inside closures, but V8’s inspector can. Each function’s
<code>[[Scopes]]</code> internal property gives the values of its captured variables, and one heap snapshot shows which
functions share the same context object, which is the part that matters: two closures over one <code>let count</code>
must still share it after the rebuild. Functions and classes keep their source text verbatim; only the state around
them is reconstructed.</p>

<p><strong>Emit</strong> writes nested scope factories that mirror V8’s context tree, object literals with the right
prototypes and property order, typed arrays that share one buffer, settled Promises and classes with their methods.
<strong>Guard</strong> turns the recorded environment reads into one condition. <strong>Verify</strong> is an
independent module that shares no code with the others: it runs the original and the output side by side and walks both
heaps in lockstep, comparing every object, descriptor, prototype, closure variable and scope identity.</p>
</div>${note(`The verifier reports the first difference as a path, for example <code>counter.get (scope var "count")</code>
or <code>views.b.buffer</code>. The emitter bugs fixed on real libraries were found this way.`)}</div>

<p>Because function and class source is reused as written, modern syntax costs nothing. A class with private members,
captured with no instances alive, comes out intact inside the scope that holds its captured <code>KEYWORDS</code>
set:</p>

${fx("private-class", {})}

<p>Binary data is captured byte for byte, including several views over one <code>ArrayBuffer</code>, which is how
<code>crc-32</code> builds its tables. Here freezedry notices that the table builders are pure and cheaper to re-run
than to spell out, re-emits them, and keeps the views pointing into the same buffer at the same offsets:</p>

${fx("crc-tables", {})}
`,
    },
    {
      id: "world",
      num: "3",
      label: "Section 3",
      title: "Mutations and the outside world",
      short: "The outside world",
      deck: "Only initialization runs, in a sealed sandbox. What it builds is the result; what it can’t know becomes a guard; what it can’t undo stops the build.",
      body: `
<p class="lede">Running real code at build time raises the obvious question: what about everything that code does
besides computing? freezedry’s answer has four parts.</p>

<h3 id="mutations">Mutations are the result</h3>

<p>Only the bundle’s top-level initialization runs, and it runs against a fresh context that shares nothing with the
build process. Whatever it mutates (its own objects, the global object, even built-in prototypes when it installs a
polyfill) is mutated inside that sandbox, and the final state of the sandbox is exactly what freezedry captures.
Deleted properties stay deleted, patched intrinsics are re-applied, and nothing leaks out to the machine doing the
build:</p>

${fx("fd-mutate", { caption: "A registry that gains and loses an entry during initialization, plus a polyfill on <code>Array.prototype</code>. The output contains only the final state." })}

<h3 id="assumptions">The environment becomes a guard</h3>

<p>Feature detection is everywhere in real bundles: <code>typeof window</code>, <code>typeof process</code>,
<code>typeof define</code>. freezedry runs initialization against a target profile (browser, worker, Node and others)
and records each probe and its answer as an assumption. The output checks all of them at startup and, if any fails,
runs the original code instead of the rebuilt heap. The check is cheap: about 0.6 µs for a typical two-clause guard,
3.7 µs for React’s fifteen clauses:</p>

${fx("env-probe", { caption: "Built for a browser. In Node, where <code>process</code> exists, the guard fails, the original code runs, and the result still matches." })}

<h3 id="bailouts">Anything else stops the build</h3>

<p>Some things can’t be frozen honestly. Reading a host value nobody asserted, reading the clock or a random number,
depending on the local time zone, and anything with a real side effect would all bake one build machine’s moment into
every user’s bundle. freezedry refuses, names the line, and leaves the original code in place:</p>

<div class="table-wrap w"><table class="bailouts">
<thead><tr><th scope="col">Initialization that depends on…</th><th scope="col">Input</th><th scope="col">What freezedry reports</th></tr></thead>
<tbody>${bailRows}</tbody></table></div>

<p>Volatile values can be allowed explicitly (<code>--allow-volatile=Date.now</code> bakes the value and documents it;
<code>--assume-tz=UTC</code> pins the time zone and adds a guard for it). Seeding <code>Math.random</code> is rejected.
State that can’t be reproduced exactly (pending Promises, non-empty <code>WeakMap</code>s, suspended generators,
<code>Proxy</code> objects) also stops the build.</p>

<h3 id="verify">And everything is checked</h3>

<p>The verifier is the last word. A result only counts when the rebuilt heap is isomorphic to the original one, from
the roots down to closure variables and shared scopes. With baked volatiles the verifier replays exactly the recorded
values, so it proves equivalence given those values.</p>
`,
    },
    {
      id: "results",
      num: "4",
      label: "Section 4",
      title: "Results on real libraries",
      short: "Results",
      deck: "22 libraries and app bundles, from 3.6 KB to 8.9 MB. No wrong outputs; the trade-off is size.",
      body: `
<div class="stat-row w">
  <div class="stat"><span class="stat-num">0</span><span class="stat-label">wrong outputs on 22 workloads, with or without opt-ins</span></div>
  <div class="stat"><span class="stat-num">${verified}</span><span class="stat-label">of 22 verified heap-identical with the documented opt-ins (${verifiedZero} with zero configuration)</span></div>
  <div class="stat"><span class="stat-num">148</span><span class="stat-label">tests in freezedry’s own suite, all passing</span></div>
</div>

<p>The benchmark corpus is the one used for the Prepack revival: 22 real libraries and app bundles, each with a smoke
test. Libraries that read the clock, a random number or an unasserted host value during initialization (lodash,
immutable, d3-scale, redux, handlebars, React, three, @babel/standalone) bail out with zero configuration and verify
once those reads are explicitly allowed. Handlebars is a good example of why running the real engine helps: it installs a
<code>globalThis</code> polyfill through Annex B’s <code>__defineGetter__</code>, which Prepack 0.2.54 didn’t model, so
Prepack shipped a bundle that throws at startup:</p>

${fx("globalthis-polyfill", { tools: ["orig", "hybrid"], caption: "The polyfill pattern from handlebars 4.7.10, reduced." })}

<p class="table-caption w">All 22 workloads (final results, from freezedry’s <code>RESULTS.md</code>). Verified = heap
isomorphic to the original, checked by the verifier, and smoke test identical; † = with baked volatile values. Sizes are
gzip of the minified output relative to the original, with the default fallback (the original source embedded behind
the guard) and with the guard and rebuilt heap only. Speedups are against the original: code cache is a
<code>vm</code> run with V8’s code cache; cold is a fresh <code>node</code> process, shown where the original takes at
least 5 ms.</p>
<div class="table-wrap w"><table class="bench">
<thead><tr><th scope="col">Workload</th><th scope="col">Zero config</th><th scope="col">With opt-ins</th><th scope="col">gzip, with fallback</th><th scope="col">gzip, residual only</th><th scope="col">Code cache</th><th scope="col">Cold <code>node</code></th></tr></thead>
<tbody>${resultRows}</tbody></table></div>

<p>mathjs and typescript compile and pass their smoke tests, but the verifier needs more than 12 GB to compare two
realms holding 18–19 MB programs, so they are counted as unverified, not as successes. prettier bails out on a
non-empty <code>WeakMap</code>, whose entries can’t be enumerated from JavaScript.</p>

<h3 id="tradeoffs">The trade-offs</h3>

<p><strong>Size.</strong> freezedry spells out the heap, and by default it also embeds the original source behind the
guard, so outputs are typically 1.25–2.5× the original after minification and gzip (lodash 3.1×, mathjs 5.8×).
Without the fallback (<code>--fallback throw</code>, for deployments whose environment is pinned) the rebuilt heap alone
is usually within 0.94–1.33× of the original (lodash 2.15×).</p>

<p><strong>Cold start.</strong> In a fresh <code>node</code> process, scanning the larger output usually costs more than
the initialization it saves (0.4–0.9× on most workloads). With V8’s code cache, where parsing is nearly free,
freezedry is faster than the original on 15 of 21 compiled workloads: handlebars and the YAML router app 3.3×, moment
2.9×, mathjs 1.8×, ramda 1.5×. It is slower on three and typescript, where rebuilding a very large heap costs more than
the code it replaces.</p>

<p><strong>Explicit opt-ins.</strong> Zero-configuration coverage is 11 of 22, because so many libraries read a clock or
a random number at load. Every opt-in is a visible decision in the build, not a silent default.</p>

<p><strong>No symbolic reasoning.</strong> freezedry knows nothing about inputs that don’t exist yet. It can’t
specialize a function for unknown arguments; it can only snapshot what initialization actually did. Where the revived
Prepack derives specialized code from a model of the program, freezedry observes the program and guards what it saw.
The next section shows how far that goes.</p>
`,
    },
    {
      id: "react",
      num: "5",
      label: "Section 5",
      title: "React: trace, then specialize",
      short: "React",
      deck: "The same run-the-real-thing idea, applied to server rendering: trace real renders, emit guarded templates, fall back to React for anything untraced.",
      body: `
<p class="lede">Server rendering a known React app for unknown request data is the classic case for specialization.
freezedry’s React mode doesn’t model React at all. It watches it.</p>

<p>The app is instrumented so every operation computes its real result in V8 and, when an operand came from request
data, also records the expression. Rendering 70 training inputs through real React yields, for each component, a tree
of the branches the data took and the HTML around each data-dependent hole. Host elements are rendered by the real
<code>react-dom/server</code> with marker strings in place of data, so escaping and attribute rules come from React
itself, and every rule a template relies on is probed against React at build time. A branch the training data never
took becomes a numbered fallback, <code>$fb(n)</code>, that hands the request to <code>renderToString</code>.</p>

<figure class="cmp cols-2"><figcaption>One component of the benchmark app (a 30-component e-commerce page) and the
template freezedry generated for it, verbatim. Props are passed positionally (<code>$p0</code> is
<code>shipsAtSec</code>, <code>$p1</code> is <code>stock</code>); <code>$tn</code> emits a text child after checking its
type; <code>$L</code> tracks whether React would insert a <code>&lt;!-- --&gt;</code> separator.</figcaption><div class="panes">
<div class="pane pane-input"><div class="pane-head"><span class="pane-label">Input</span><span class="pane-file">StockBadge in app.jsx</span></div>${code(react.component)}</div>
<div class="pane" data-status="ok"><div class="pane-head"><span class="pane-label">freezedry</span><span class="pane-sub">traced template</span></div>${code(
        react.hybridTemplate,
        { cls: "wrap" }
      )}</div>
</div></figure>

<p>On the benchmark’s fixed 500-input check corpus the output is byte-identical to React: 500 of 500. Two of the 500
fall back, both hand-written edge cases the training data never produced. On 50,000 randomly mutated inputs there were
no mismatches at all, and inputs that make the app throw throw the same error. A cached build loads, prepares and
renders its first page in about 5 ms, against 16 ms for React.</p>

<p class="table-caption w">Renders per second relative to <code>ReactDOMServer.renderToString</code>, same machine, same
run (<code>react-bench/perf.js</code>, November 5, 2026). Small pages are about 6 KB of HTML, large ones about 285 KB.</p>
<div class="table-wrap w"><table class="react-perf">
<thead><tr><th scope="col"></th><th scope="col">JIT, small</th><th scope="col">JIT, large</th><th scope="col">jitless, small</th><th scope="col">jitless, large</th></tr></thead>
<tbody>
<tr><th scope="row">React <code>renderToString</code></th><td>1.00×</td><td>1.00×</td><td>1.00×</td><td>1.00×</td></tr>
<tr><th scope="row">freezedry templates</th><td>5.68×</td><td>4.64×</td><td>10.61×</td><td>10.68×</td></tr>
<tr class="muted-row"><th scope="row">Hand-written specialization</th><td>8.42×</td><td>6.51×</td><td>18.53×</td><td>17.45×</td></tr>
</tbody></table></div>

<p>Coverage is only as good as the training data, which is the price of never modeling anything: with 20 + 2 training
pages, about 30% of requests fall back. With 70 it is 0.4%, and inputs that fell back can be collected and fed into the
next build.</p>
`,
    },
    {
      id: "more",
      num: "6",
      label: "Section 6",
      title: "What’s left, and where to find it",
      short: "What’s left",
      deck: "Open problems, and the code.",
      body: `
<ul class="links">
  <li><strong>prettier</strong> bails on a non-empty <code>WeakMap</code>. Recovering its entries from V8’s heap snapshot,
  with a proof that the keys are reachable, would fix it without approximating.</li>
  <li><strong>The verifier’s memory</strong> on 18–19 MB programs: streaming the heap snapshot or running the two realms in
  separate processes would let mathjs and typescript be verified.</li>
  <li><strong>Output size</strong> on heaps full of derived data (mathjs): recompute-or-lazy emission for pure derived
  tables, generalizing what already happens for <code>ArrayBuffer</code> tables.</li>
  <li><strong>Cold start</strong>: an external or lazily compiled fallback instead of embedding the original source.</li>
  <li><strong>Zero-configuration coverage</strong>: many clock reads at load end up in dead or scratch state (lodash’s
  hot-call detector, d3-time’s scratch dates) and could be proven irrelevant instead of needing an opt-in.</li>
</ul>

<p>The code, tests and full results are at <a href="${REPO}">github.com/jlongster/freezedry</a>. Its origins, and the
other half of the experiment, are in <a href="${PREPACK_POST}">Prepack, revived</a>.</p>

<h3 id="methods">How this page was made</h3>

<p>Every code panel is the unedited output of freezedry (then still called the “hybrid”), produced by
<code>site/scripts/run-examples.js</code> in the Prepack revival repository on November 5, 2026, on Node v26.7.0;
long lines in the React template wrap. The bail-out messages are the first line freezedry prints for each input. The
results table is transcribed by script from freezedry’s final <code>RESULTS.md</code>; the React numbers come from
the shared <code>react-bench</code> harness.</p>
`,
    },
  ];

  render({
    title: "freezedry",
    description:
      "freezedry runs a JavaScript bundle’s initialization in the real engine, captures the heap through the inspector, and emits JavaScript that rebuilds it, with runtime guards and a heap-isomorphism verifier.",
    ogDescription: `Run initialization once in V8, ship the heap it built. ${verified} of 22 real libraries verified heap-identical, 0 wrong outputs.`,
    parts,
    out: path.join(__dirname, "dist"),
    footer: `Built from <code>site/freezedry/</code> in <a href="https://github.com/jlongster/prepack-revived">jlongster/prepack-revived</a>. Project: <a href="${REPO}">jlongster/freezedry</a>.`,
    cover: contents => `
<section class="cover grid" aria-labelledby="title">
  <div class="cover-text">
    <p class="kicker">freezedry · November 2026</p>
    <h1 id="title">freezedry</h1>
  </div>
  <div class="cover-main">
  <p class="dek">Run a JavaScript bundle’s initialization once, in the real engine, and ship JavaScript that rebuilds
    the heap it left behind, with a guard for everything the build machine can’t know and a verifier that checks the
    result object by object.</p>
  <div class="cover-stats">
    <div class="stat-row">
      <div class="stat"><span class="stat-num accent">${verified}</span><span class="stat-label">of 22 real libraries rebuilt heap-identical, checked by an independent verifier</span></div>
      <div class="stat"><span class="stat-num">0</span><span class="stat-label">wrong outputs; everything else bails out and keeps the original code</span></div>
      <div class="stat"><span class="stat-num">500/500</span><span class="stat-label">React pages byte-identical from traced templates, up to 10.7× faster</span></div>
    </div>
  </div>
  </div>
  ${contents}
</section>`,
  });
};
