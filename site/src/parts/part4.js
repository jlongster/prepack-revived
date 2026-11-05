"use strict";

module.exports = c => {
  const { example, note, pipeline, react, code } = c;
  return `
<p class="lede">About 35,000 of Prepack’s 81,000 lines re-implement the ECMAScript spec, and that is where real
libraries keep finding gaps: a missing <code>globalThis</code>, an Annex B corner, a class feature. The hybrid
removes that tail entirely. The initialization code runs in V8, so its semantics are exact by construction; the work
moves to capturing what it built, and to being honest about what can’t be captured.</p>

<h3 id="b-pipeline">Run, capture, emit, guard, verify</h3>

<figure class="w chart">
${pipeline([
  { title: "Run", lines: ["init code in a fresh vm", "context; trace reads of", "the environment"] },
  { title: "Capture", lines: ["walk the heap via the", "inspector: [[Scopes]],", "heap-snapshot contexts"] },
  { title: "Emit", lines: ["JavaScript that rebuilds", "objects, closures and", "their shared scopes"] },
  { title: "Guard", lines: ["environment assumptions", "become a runtime check;", "on mismatch, run original"] },
  { title: "Verify", lines: ["run both in fresh", "contexts; compare heaps", "object by object"] },
])}
<figcaption>The hybrid pipeline. Everything uses Node’s built-in <code>vm</code>, <code>inspector</code> and
<code>v8</code> modules; there is no custom interpreter.</figcaption>
</figure>

<div class="wn"><div class="b">
<p><strong>Run.</strong> The input runs in a fresh V8 context with a membrane between the global object and its
prototype, so every read of a global that isn’t plain ECMAScript (<code>window</code>, <code>process</code>,
<code>localStorage</code>) is recorded. Volatile calls such as <code>Date.now()</code> or <code>Math.random()</code>
stop the build unless explicitly allowed, because baking a build-time timestamp into a bundle is exactly the kind of
silent wrongness the project exists to avoid.</p>

<p><strong>Capture.</strong> JavaScript can’t see inside closures, but V8’s inspector can. Each function’s
<code>[[Scopes]]</code> gives the values of its captured variables, and one heap snapshot reveals which functions
share the same scope object, which is the part that matters: two closures over one <code>let count</code> must still
share it after the rebuild.</p>

<p><strong>Emit</strong> writes nested scope factories that mirror V8’s context tree, object literals with the right
prototypes and property order, typed arrays that share one buffer, settled Promises, classes with their methods.
<strong>Guard</strong> turns the recorded environment reads into a single condition, and <strong>Verify</strong>,
written as an independent module that shares no code with the others, runs the original and the output side by side
and walks both heaps in lockstep, comparing every object, descriptor, prototype, closure variable and scope identity.</p>
</div>${note(`The oracle reports the first difference as a path, for example
<code>counter.get (scope var "count")</code> or <code>views.b.buffer</code>, which made the emitter’s bugs quick to find.`)}</div>

<h3 id="b-examples">Where it works well</h3>

<p>Closures that share state are the first test of any heap snapshot written as JavaScript. All four versions get this
one right, but compare how they get there: the hybrid recreates the shared scope as a real scope, with the
<code>count</code> it had at the end of initialization.</p>

${example("hyb-closures", { caption: "Three closures over one scope, after two calls during initialization." })}

<p>Modern syntax costs the hybrid nothing, because it re-emits function and class source text verbatim and only
reconstructs the state around it. This is the class from Part 3; the output keeps the class intact, with private
members, inside the scope that holds its captured <code>KEYWORDS</code> set:</p>

${example("hyb-class", { tools: ["hybrid"], caption: "The hybrid’s output for the class with private members." })}

<p>Libraries that broke Prepack in the environment break nothing here. Handlebars installs a <code>globalThis</code>
polyfill through Annex B’s <code>__defineGetter__</code>; 0.2.54 didn’t model either and shipped a bundle that throws.
The revived Prepack needed both features added to its spec implementation; the hybrid just ran it:</p>

${example("hyb-handlebars", { caption: "The polyfill pattern from handlebars 4.7.10, reduced." })}

<p>Binary data is captured byte for byte, including several views over one <code>ArrayBuffer</code>, which is how
<code>crc-32</code> builds its tables. Here the hybrid’s cost model notices that the table builders are pure and
re-emits them rather than the 4 KB of bytes, but keeps the views pointing into the same buffer at the same offsets:</p>

${example("hyb-tables", { trim: { orig: { head: 14, tail: 4, cols: 140 }, revived: { head: 14, tail: 4, cols: 140 } }, caption: "CRC tables in typed arrays. 0.2.54 doesn’t know <code>globalThis</code> and its output throws; the revived build writes the tables out in full." })}

<p>The guard is where the hybrid is most explicit. This input probes for <code>window</code>,
<code>process</code> and <code>localStorage</code>. Built for a browser, the output checks those three facts at
startup, then either rebuilds the captured heap or runs the original code:</p>

${example("hyb-guard", { caption: "An emitted guard with its fallback. In Node, where <code>process</code> exists, the fallback runs and the result matches the original." })}

<h3 id="b-libs">Real libraries</h3>

<p>The benchmark corpus has 22 real libraries and apps, from 3.6 KB (<code>crc-32</code>) to 8.9 MB
(<code>typescript</code>). With the documented opt-ins for volatile calls, 19 of them pass the heap-isomorphism oracle,
including several Prepack never handled:</p>

<div class="table-wrap w"><table class="libs">
<thead><tr><th scope="col">Library</th><th scope="col">Input</th><th scope="col">Prepack when the benchmark was added</th><th scope="col">Hybrid</th></tr></thead>
<tbody>
<tr><th scope="row">crc-32</th><td>3.6 KB</td><td>Fails: loop over a typed array</td><td>Heap-identical</td></tr>
<tr><th scope="row">d3-scale</th><td>149 KB</td><td>Fails: <code>class extends Map</code>, default parameters</td><td>Heap-identical, with <code>new Date</code> allowed</td></tr>
<tr><th scope="row">handlebars</th><td>212 KB</td><td>Wrong: bundle throws at startup</td><td>Heap-identical, with <code>Math.random</code> allowed</td></tr>
<tr><th scope="row">marked</th><td>49 KB</td><td>Fails: modern syntax</td><td>Heap-identical</td></tr>
<tr><th scope="row">highlight.js</th><td>1.8 MB</td><td>Wrong: bundle throws at startup</td><td>Heap-identical</td></tr>
<tr><th scope="row">three</th><td>1.9 MB</td><td>Fails: loop over a typed array</td><td>Heap-identical, with <code>Math.random</code> allowed</td></tr>
<tr><th scope="row">@babel/standalone</th><td>5.2 MB</td><td>Fails after 13 s and 1 GB</td><td>Heap-identical, with clock and random allowed</td></tr>
<tr><th scope="row">prettier</th><td>1.1 MB</td><td>Fails: modern syntax</td><td>Clean bail-out: a non-empty <code>WeakMap</code> can’t be emitted exactly</td></tr>
</tbody></table></div>

<p>Of the other three, prettier bails out as shown, and the oracle run did not complete for
<code>typescript</code> and <code>mathjs</code>. (The revived Prepack has since fixed several of the failures above too: crc-32, d3-scale, handlebars, marked, highlight.js,
and three all compile with it now; @babel/standalone does too, given assumptions about its environment, in 279 seconds.)</p>

<h3 id="b-tradeoffs">The trade-offs</h3>

<p>The hybrid gives up three things. <strong>Size:</strong> it spells out the heap, so outputs are typically 1.5–3.7× the
original after gzip, against 0.9–1.35× for most libraries with the revived Prepack. <strong>Cold start:</strong> parsing that larger output
usually costs more than the initialization it saves. In a fresh <code>node</code> process most libraries start
slower; with V8’s code cache, where parsing is nearly free, several start much faster (moment 2.4×, handlebars 2.7×,
crc-32 2.3×). That is the same condition the Prepack README named in 2017. <strong>Reasoning:</strong> the hybrid knows
nothing symbolic. It can’t specialize a function for unknown arguments, only snapshot what initialization actually did,
and every environment read or volatile call needs a guard or an explicit opt-in.</p>

<p>What it gets in return is breadth and exactness. It has no spec to keep up with, and a verifier that checks the one
property that matters: the rebuilt heap is the heap the original built.</p>

<h3 id="b-react">React: trace, then specialize</h3>

<p>For React, the hybrid replaces symbolic evaluation with <em>traces</em>. The app is instrumented so every operation
computes its real result in V8 and, when an operand came from request data, also records the expression. Rendering
70 training inputs through real React yields, for each component, a tree of the branches the data took and the HTML
around each data-dependent hole. Host elements are rendered by the real <code>react-dom/server</code> with marker
strings in place of data, so escaping and attribute rules come from React itself, and every rule the template relies on
is probed against React at build time. Each branch the training data never took becomes a numbered fallback,
<code>$fb(n)</code>, that hands the request to <code>renderToString</code>.</p>

<figure class="cmp cols-2"><figcaption>The same component as in Part 3, and the template the hybrid generated for it
(verbatim from <code>generated-template.js</code>). Props are passed positionally (<code>$p0</code> is
<code>shipsAtSec</code>, <code>$p1</code> is <code>stock</code>); <code>$tn</code> emits a text child after checking its
type; <code>$L</code> tracks whether React would insert a <code>&lt;!-- --&gt;</code> separator.</figcaption><div class="panes">
<div class="pane"><div class="pane-head"><span class="pane-label">Input</span><span class="pane-file">StockBadge in app.jsx</span></div>${code(react.component)}</div>
<div class="pane" data-status="ok"><div class="pane-head"><span class="pane-label">Hybrid</span><span class="pane-sub">traced template</span></div>${code(react.hybridTemplate, { cls: "wrap" })}</div>
</div></figure>

<p>On the 500-input check corpus the output is byte-identical to React (500/500, re-checked for this article). Two of
the 500 fall back, both hand-written edge cases the training data never produced; on 50,000 randomly mutated inputs
there were no mismatches at all, and inputs that make the app throw throw the same error. A cached build loads,
prepares and renders its first page in about 5 ms, against 16 ms for React.</p>

<p class="table-caption w">Renders per second relative to <code>ReactDOMServer.renderToString</code>, same machine, same run
(<code>react-bench/perf.js</code>, November 5, 2026). Small pages are about 6 KB of HTML, large ones about 285 KB.</p>
<div class="table-wrap w"><table class="react-perf">
<thead><tr><th scope="col"></th><th scope="col">JIT, small</th><th scope="col">JIT, large</th><th scope="col">jitless, small</th><th scope="col">jitless, large</th></tr></thead>
<tbody>
<tr><th scope="row">React <code>renderToString</code></th><td>1.00×</td><td>1.00×</td><td>1.00×</td><td>1.00×</td></tr>
<tr><th scope="row">Revived Prepack</th><td>5.39×</td><td>4.10×</td><td>8.96×</td><td>10.08×</td></tr>
<tr><th scope="row">Hybrid (traced templates)</th><td>5.68×</td><td>4.64×</td><td>10.61×</td><td>10.68×</td></tr>
<tr class="muted-row"><th scope="row">Hand-written specialization</th><td>8.42×</td><td>6.51×</td><td>18.53×</td><td>17.45×</td></tr>
</tbody></table></div>

<p>The two approaches land in the same place from opposite directions. Prepack derives the specialized renderer from a
model of React and proves it correct for every input in a schema. The hybrid observes real React on real inputs and
guards every assumption, so its coverage is only as good as its training data, but it never has to model anything. The
<a href="https://jamesbox.exe.xyz/northstar/">Northstar Supply demo</a> serves the same page three ways, with plain
React, the revived Prepack and the hybrid.</p>
`;
};
