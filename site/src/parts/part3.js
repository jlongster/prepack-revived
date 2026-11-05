"use strict";
const { ISSUE } = require("../quotes.js");

module.exports = c => {
  const { example, quote, note, folderTable, summary, react, code, reactExample, reactExamples, esc } = c;
  const I = n => `<a href="${ISSUE(n)}">#${n}</a>`;
  const o = summary("orig");
  const r = summary("revived");
  const groups = folderTable();
  const NAMES = {
    "P1-loops": "P1 Loops",
    "P2-recursion": "P2 Recursion",
    "P3-joins": "P3 Control-flow joins",
    "P4-paths": "P4 Path conditions",
    "P5-ranges": "P5 Numeric facts",
    "P6-havoc": "P6 Havoc and built-ins",
    "P7-environment": "P7 Environment",
    "P8-size": "P8 Output size",
    "P9-generators-async": "P9 Generators and async",
    fuzz: "Fuzzer-found bugs",
    "real-world": "Real-world init snippets",
    "real-world-libs": "Real library excerpts",
  };
  const folderRows = Object.keys(NAMES)
    .map(f => {
      const g = groups[f];
      const bar = (n, total, cls) =>
        `<span class="mbar ${cls}" style="--v:${((n / total) * 100).toFixed(1)}%"><span></span></span><span class="mnum">${n}/${total}</span>`;
      return `<tr><th scope="row">${NAMES[f]}</th><td>${bar(g.orig.PASS || 0, g.orig.total, "old")}</td><td class="wr">${
        g.orig.WRONG || 0
      }</td><td>${bar(g.revived.PASS || 0, g.revived.total, "new")}</td><td class="wr">${g.revived.WRONG || 0}</td></tr>`;
    })
    .join("");

  return `
<p class="lede">Each problem below gets the same treatment: what the original developers said about it, the
technique the revived Prepack uses, what is still out of reach, and a real before/after. One rule holds throughout:
when Prepack can’t show that a transformation is right, it stops with a diagnostic instead of emitting something that
might be wrong. First, the overall result.</p>

<h3 id="corpus">The hard-case corpus</h3>

<div class="wn"><div class="b">
<p>To measure the problems rather than argue about them, we turned the issue tracker into a corpus of 194 small,
deterministic programs: the repros from the issues above, variants of them, minimized bugs found by a differential
fuzzer, and excerpts of real libraries. Each program names its source issue and its goal in a header, and runs
unchanged in plain Node, so every case can be checked by running the original and Prepack’s output side by side.</p>
</div>${note(`<strong>Scoring.</strong> <code>scripts/hard-scoreboard.js</code> runs every corpus program in plain
Node and through Prepack, runs both, and compares. A case is PASS only with no error, the same result, and output at
most 2× the input. WRONG means Prepack reported success and the program computes something else.`)}</div>

<p>On the 194 cases, the published Prepack 0.2.54 passes ${o.PASS}, crashes or reports an error on ${o.CRASH}, and is
<em>silently wrong</em> on ${o.WRONG}. The revived build passes ${r.PASS}, with ${r.WRONG} wrong and ${r.CRASH} clean
errors. Prepack’s own regression suite passes 3,744 of 3,744 runs (the original has 3,378), and across 22 real-world
libraries and six option profiles each, the revived build produces no wrong output.</p>

<div class="table-wrap w"><table class="folders">
<thead><tr><th scope="col">Corpus folder</th><th scope="col">0.2.54 passes</th><th scope="col">wrong</th><th scope="col">Revived passes</th><th scope="col">wrong</th></tr></thead>
<tbody>${folderRows}</tbody>
<tfoot><tr><th scope="row">All 194 cases</th><td><span class="mnum">${o.PASS}/194</span></td><td class="wr">${o.WRONG}</td><td><span class="mnum">${r.PASS}/194</span></td><td class="wr">${r.WRONG}</td></tr></tfoot>
</table></div>

<p>The four remaining errors are deliberate: a test that checks the duplicate-name diagnostic, an unfrozen object
leaking from global code (reported, as the original test suite expects), a generator left suspended at the end of
initialization (see <a href="#lang">modern JavaScript</a>), and one fuzzer case that bails out cleanly with correct
recovered output.</p>

<h3 id="a-loops">P1 · Loops</h3>

${quote("venter-1174")}

<p>That was the plan in 2017, and it is what the revived Prepack does, in <code>residualLoop.js</code>. It still tries to
unroll a loop first. When that fails it rewrites the loop into a small closure, passes in the values the loop only
reads, marks the objects it writes as escaped, and emits the loop as residual code at the right point in time. Before
accepting the residual loop it evaluates one symbolic iteration against that state and checks every effect: if the
body could touch anything that wasn’t accounted for, Prepack refuses with a diagnostic instead of guessing. The first
case is ${I(1174)} itself:</p>

${example("loops-1174", { caption: "A loop with an unknown bound in an optimized function. 0.2.54 exits with an error that has no message (the symptom reported in #2396), though the code it prints happens to work. The revived build emits the residual loop cleanly." })}

<p>${I(1722)} is the case Venter answered with “game over.” State built before the loop is lost when the loop is
widened. In 0.2.54 the output is not just imprecise, it is wrong: the first two keys disappear and the rest shift by
one.</p>

${example("loops-1722", { caption: "#1722, with the unknown bound named <code>n0</code>. The revived build keeps the pre-loop state and emits the loop itself." })}

<p>And ${I(2055)}, Nikolai Tillmann’s “hard problem”: a <code>while</code> loop scanning a string whose contents are
unknown.</p>

${example("loops-2055", { caption: "#2055. The revived build passes the string into the loop closure as a read-only parameter; only the counter is shared." })}

<p>All 21 loop cases pass, including Babel-lowered <code>for-of</code> loops with large <code>switch</code> bodies
(${I(2053)}, ${I(2477)}), labeled <code>break</code>/<code>continue</code>, and <code>return</code> or
<code>throw</code> inside loops. What stays out is honest: a loop inside an optimized function that mutates global
state, or a global-code loop that calls unknown functions, is refused with a clear diagnostic, because summarizing
arbitrary heap effects over an unknown number of iterations needs whole-program reasoning. That is the part of the
problem that is undecidable in general, and the residual loop sidesteps it only when the effects are local.</p>

<h3 id="a-recursion">P2 · Recursion</h3>

${quote("src-call-1586")}

<p>The disabled code had five structural bugs (it always aborted at the end anyway). It is replaced
by <code>recursion.js</code>, built on one insight: recursion that stays concrete keeps unrolling, but as soon as a recursive call is
reached under a new abstract condition, Prepack stops and emits a call to the original function. In optimized
functions it first checks that the cluster of functions involved only touches state it can account for; in global code
it snapshots everything the function reads and proves that nothing changes it afterwards.</p>

${example("recursion-fib", { caption: "<code>fib</code> called with an unknown argument. 0.2.54 unrolls the recursion without bound; the run was killed after 60 seconds with no output. The revived build emits a residual call." })}

${example("recursion-fact", { caption: "Global code: 0.2.54 unrolls <code>fact</code> to the maximum stack depth and stops with PP0045." })}

<p>All 13 recursion cases pass, including mutual recursion, tree walks, a recursive-descent parser over an unknown
string, and deep clone. ${I(543)}’s original one-liner is worth a footnote: by 0.2.54 it no longer exploded to 1,065
lines, because a later fix removed the dead <code>Date.now()</code> calls. The underlying problem, unrolling recursion
on unknown values, is what the cases above measure.</p>

<h3 id="a-joins">P3 · Control-flow joins and the fuzzer</h3>

<p>When an <code>if</code> on an unknown value contains a <code>return</code>, Prepack has to carry both futures
forward and join them later. The original design spread that across ten completion classes, host exceptions, and a
piece of mutable state on the realm. The fuzzer’s 2018 bugs live here:</p>

${example("joins-2354", { caption: "#2354, found by the original fuzzer. The 2018 repro used booleans; with other falsy values 0.2.54 still returns <code>NaN</code> where the program returns <code>false</code>." })}

${example("joins-2355", { caption: "#2355: <code>if (a) return true; return false;</code> must return a boolean." })}

${example("joins-labeled", { caption: "A <code>break</code> out of a labeled block under an unknown condition. 0.2.54 drops the break and folds the function to a constant." })}

<p>These trace back to a handful of root causes: the saved-completion state was never scoped at
<code>switch</code>, labeled-statement and <code>try</code> boundaries; two simplifier rules erased boolean
conversions; a joined completion reported only its first branch’s value. Fixing those made room for the two features
the tracker had asked for. <code>switch</code> on an unknown value (${I(1378)}, “level 4 (hard)”) now handles fall-through
and returns:</p>

${example("joins-switch-1378", {})}

<p>And <code>try/catch</code> around code that might throw, which used to be a hard error (PP0021, ${I(2120)}), is
now emitted as a residual <code>try</code>:</p>

${example("joins-try-2120", { caption: "0.2.54 reports PP0021 and prints code without the <code>catch</code>; that code throws where the original returns 42." })}

<div class="wn"><div class="b">
<p>A differential fuzzer generated 48,898 programs covering loops, labels, <code>switch</code>,
<code>try</code>, objects, arrays and closures. It found 1,260 silently wrong programs and 469 internal invariant
failures, which minimized to dozens of distinct bugs. Every one became a corpus case: 44 now live in
<code>test/serializer/hard/fuzz/</code>. On those 44, 0.2.54 is wrong on ${groups.fuzz.orig.WRONG} and crashes on
${groups.fuzz.orig.CRASH}. The revived build passes ${groups.fuzz.revived.PASS}.</p>
</div>${note(`A cleaner design would replace the ten completion classes with a
single map from exit kind (<code>return</code>, <code>throw</code>, <code>break label</code>…) to a guarded branch.
Patching them instead (about 350 lines) fixed every known bug without a rewrite.`)}</div>

<h3 id="a-paths">P4 · Path conditions, checked by Z3</h3>

<p>Prepack’s logic engine was a set of hand-written rewrite and implication rules. Rather than write better rules,
the revived Prepack asks a real SMT solver. Z3 runs as a persistent child process behind two named pipes, so
Prepack, which is synchronous throughout, can ask it questions with blocking reads (about 1 ms per query). Every
JavaScript value is encoded as a tagged datatype with exact IEEE-754 special cases for <code>NaN</code>,
<code>±Infinity</code> and truthiness, and the encoding itself was tested against Node on 3,000 random expressions.</p>

<p>Z3 then did two jobs. In normal runs it answers implication and feasibility questions the rules can’t, and prunes
branches that can never execute. In <em>audit mode</em>, it checks every rewrite the old rules perform: if
<code>X → Y</code> and <code>X ≠ Y</code> is satisfiable, that is a bug, with a counterexample. Run over the test suite
and the corpus, the audit produced 3,993 failure reports from 20 distinct places in the code. A few of them:</p>

<div class="table-wrap w"><table class="audit">
<thead><tr><th scope="col">Rule in the original simplifier</th><th scope="col">Z3 counterexample</th></tr></thead>
<tbody>
<tr><td><code>c ? true : false</code> &nbsp;→&nbsp; <code>c</code></td><td><code>c = 0</code>: left is <code>false</code>, right is <code>0</code></td></tr>
<tr><td><code>(0 !== x)</code> implies <code>x</code> is truthy</td><td><code>x = false</code> (also <code>""</code>, <code>null</code>, <code>NaN</code>)</td></tr>
<tr><td><code>x != null</code> implies <code>x</code> is truthy</td><td><code>x = false</code></td></tr>
<tr><td><code>!(x != null)</code> implies <code>x === null</code></td><td><code>x = undefined</code></td></tr>
<tr><td><code>x == null</code> implies <code>x === null</code></td><td><code>x = undefined</code></td></tr>
<tr><td><code>x === +0</code> implies <code>!(x === -0)</code></td><td><code>x = 0</code></td></tr>
<tr><td><code>((c ? 1 : y) === y)</code> &nbsp;→&nbsp; <code>!c</code></td><td><code>c = false, y = NaN</code></td></tr>
</tbody></table></div>

<p>Thirteen unsound rules were fixed or deleted, and the audit now reports zero failures across 34,047 checks. Here is
one the fuzzer found and the audit explained:</p>

${example("paths-negation", { caption: "<code>!(a == null ? 0 : a)</code> was simplified to <code>a == null</code>, which is wrong for every falsy non-null value." })}

<p>The cost is real but bounded: on the full serializer suite, Z3 adds about two and a half minutes to a four and a
half minute run, because 98.8% of queries hit a cache. What Z3 can’t do here is also documented: it reasons about
numbers as exact reals, so it believes <code>x + 1 &gt; x</code> even at 2<sup>53</sup>.</p>

<h3 id="a-ranges">P5 · Numeric facts</h3>

<p>The fix is an interval domain: every numeric abstract value carries bounds, whether it is an integer,
and whether it might be <code>NaN</code> or <code>-0</code>, derived from the expression and refined by the current
path conditions. An array whose length is “0 or 1” can then be pushed to, by splitting on the few possible lengths:</p>

${example("ranges-1066", { caption: "#1066, opened by Nikolai Tillmann in 2017." })}

<p>The same machinery handles <code>table[n &amp; 3]</code>, clamped loop bounds and array methods on short
abstract-length arrays. Along the way it turned up a bug unrelated to abstract values: the original
<code>Array.prototype.shift</code> started its copy loop at the wrong index, writing the removed element to
<code>O["-1"]</code>.</p>

<h3 id="a-havoc">P6 · Built-ins and the outer fixed point</h3>

${quote("venter-1891")}

<p>That was the bind: anything handed to code Prepack couldn’t see had to be havoced, and havocing too much makes the
analysis useless. ${I(2319)} listed Facebook’s top built-in bail-outs: <code>RegExp.prototype.test</code> (275),
<code>Array.prototype.indexOf</code> (201), <code>parseInt</code> (176) and <code>Math.abs</code> (58). This is the
kind of tedious, spec-heavy work a small team never has time for: 81 built-ins now carry declarative effect
summaries (what they coerce, whether they can throw, whether they can run user code), each with a differential test.</p>

${example("builtins-2319", { caption: "All of #2319’s top four in one function. 0.2.54 reports three fatal errors, then prints code that happens to work." })}

<p>The lazy cache from ${I(1750)} needed the “outer fixed point” Venter called a bridge too far. The revived build
evaluates the optimized function while recording which outer state it reads; any state it both reads and writes is
made abstract, and the function is evaluated again until nothing changes. 0.2.54 baked the first call’s cache state
into every call:</p>

${example("havoc-1750", { caption: "#1750. Both builds print a warning about the mutation; only one gets the counts right." })}

<p>Two parts of P6 remain open in general. Distinct object parameters are still assumed not to alias unless something
proves otherwise, and a method call on an untyped receiver (<code>arr.indexOf(x)</code> where <code>arr</code> could
be anything) still has to assume the worst about its arguments.</p>

<h3 id="a-env">P7 · The environment</h3>

${quote("venter-24-nothing")}

<p>The original models were closed-world: a global Prepack didn’t know about was assumed not to exist. That produced
the worst kind of failure, a build that succeeds with a warning and ships a bundle that throws on startup:</p>

${example("env-process", { caption: "0.2.54 compiles a reference to <code>process</code> into a program whose only action is to throw a ReferenceError. The revived build leaves environment reads residual." })}

${example("env-window", { caption: "Feature detection folded against Prepack’s own environment: in 0.2.54, a browser with <code>fetch</code> is told it has none." })}

<p>Three changes fix it. Unknown globals are now <em>open-world</em>: they become residual
reads. Models for the DOM, Node and <code>Intl</code> are generated from TypeScript’s <code>lib.dom.d.ts</code> and
<code>@types/node</code> (77 interfaces, 102 DOM globals), which, as it happens, is what a commenter on ${I(24)}
suggested in 2017. And specializing on the environment is now explicit: <code>--assume</code> folds an assumption and
emits a runtime guard, with the original code as the fallback:</p>

${example("env-guard", { caption: "<code>--assume 'process.env.NODE_ENV=\"production\"' --assume timezoneOffset=0</code>. The time-zone guard checks two dates half a year apart so daylight saving time can’t pass it by accident. On a machine in India the guard fails and the original code runs." })}

<h3 id="a-size">P8 · Output size</h3>

<p>The revived Prepack attacks bloat at three levels: serializer peepholes (dead intermediate writes, compact
<code>Error</code> objects, <code>Object.create</code> instead of a prototype-swapping constructor), a cost model that
decides at serialization time whether to write out a computed object graph or the code that computed it, and limits on
inlining. The cost model is the important one:</p>

${example("size-table", { trim: { orig: { head: 6, tail: 4, cols: 160 } }, caption: "A 1,000-iteration init loop. 0.2.54 writes the table out, along with every intermediate value of <code>i</code>. The revived build verifies the loop is pure and self-contained, then keeps the loop." })}

${example("size-error", { caption: "An <code>Error</code> created at init. 0.2.54 rebuilds it as a plain object with the build machine’s stack trace baked in, so it is no longer a real Error. The revived build emits <code>new TypeError(...)</code>." })}

<p>The same recomputation logic fixed the biggest real-world regression. lodash builds its whole API inside
<code>runInContext()</code> and keeps a reference to that factory, so materializing the result paid for the factory
and its output twice. Re-emitting the call instead took lodash from 3.16× to 1.05× its minified size; curried
function factories took ramda from 2.54× to 1.23×. Across the corpus, total output shrank by 40.5%, and no case is
larger than twice its input.</p>

<h3 id="lang">Modern JavaScript</h3>

<p>Venter expected updating Prepack to modern JavaScript to “be a lot of work,” and it was, but it was the kind of work
that is mostly transcription. The parser now accepts ES2022 class fields and private members, optional catch bindings,
<code>??</code>, optional chaining and BigInt. Generators that are created and finished during initialization are
lowered to a state machine and run, and settled Promises are serialized as <code>Promise.resolve(…)</code> after
draining a real job queue. A generator still <em>suspended</em> at the end of initialization is refused on purpose:
its state lives in lowered closures with no equivalent in the source, and emitting a runtime to resume it would trade
fidelity for coverage. Venter’s question from ${I(712)}, how to iterate a generator through an <code>if</code> whose
condition is abstract, is still open: generators run at build time only when everything about them is concrete.</p>

${example("private-class", { tools: ["orig", "revived"], caption: "A class with private members. 0.2.54 prints a program that is a SyntaxError." })}

<h3 id="a-bench">Real-world results</h3>

${c.benchSection()}

<h3 id="a-react">React, revisited</h3>

<p>The React compiler of 2018 tried to fold React itself. The revival took a narrower route: specialize React 18
server rendering of a <em>known</em> app for <em>unknown</em> request data. The app is a 30-component e-commerce page
(the same one behind the Northstar demo linked below); the data is a different
product listing on every request. Instead of evaluating the real <code>react-dom/server</code>, which keeps its state
in long-lived queues Prepack can’t summarize, we ported React’s server renderer into about 1,300 lines written
in a style Prepack <em>can</em> evaluate: every function restores what it changes. The attribute tables are copied
verbatim from react-dom 18.3.1. Prepack then specializes the whole render for a data schema inferred from training
inputs. Here is one small component and the code Prepack produced for one place it is used:</p>

<figure class="cmp cols-2"><figcaption>One component from the benchmark app (<code>app.jsx</code>) and the corresponding
fragment of the revived Prepack’s generated renderer (one expression, verbatim; the full program is 83,754 bytes). React
is gone: the result is string concatenation with the branches the data needs.</figcaption><div class="panes">
<div class="pane"><div class="pane-head"><span class="pane-label">Input</span><span class="pane-file">StockBadge in app.jsx</span></div>${code(react.component)}</div>
<div class="pane" data-status="ok"><div class="pane-head"><span class="pane-label">Revived Prepack</span><span class="pane-sub">react-ssr specialization</span></div>${code(react.prepackFragment.replace(/ \? /g, "\n  ? ").replace(/ : /g, "\n  : "), { cls: "wrap" })}<div class="pane-meta">line breaks added at <code>?</code> and <code>:</code> for reading</div></div>
</div></figure>

<p>The examples below are bigger. Each is a small app built from real components of the same page, compiled on its
own with the same compiler and training inputs, so the renderer Prepack generated for those components can be read in
one place. The inputs are the components exactly as they appear in <code>app.jsx</code>, plus a few lines of wrapper;
the outputs are excerpts of the generated code, with the omitted lines marked.</p>

<h4 id="react-list">A list of unknown length</h4>

<p>In 2018 this is where the React compiler stopped: components with loops were excluded from compilation, and a
<code>map()</code> callback over unknown data was left unevaluated, dragging the original component into the bundle
(${I(2141)}, ${I(2142)}). Here the callback is specialized once and run by a residual loop
(<code>__ssrMapJoin</code>). Each item becomes a single string expression: the badge conditions turn into
ternaries, the title is escaped at runtime, and React’s <code>&lt;!-- --&gt;</code> separators around the stock count
appear exactly where React puts them.</p>

${reactExample("react-list", {
  file: "ProductList, ProductBadges",
  caption: "A product list with per-item badges and stock state (<code>StockBadge</code> is the component shown above).",
  ranges: [
    ["var _1 = function (data) {", "var _$B = _$4.originalPrice;"],
    ["var _3G = 1 + (_3J - _$S);", 'return "<ul class=', 1],
    ["var _43 = function (value) {", "};"],
  ],
})}

<h4 id="react-cart">Context and <code>useMemo</code></h4>

<p>Contexts are pure plumbing at render time, so the providers and <code>useContext</code> calls fold away entirely:
the locale becomes a plain read of <code>data.locale</code>. <code>useMemo</code> runs once per server render, so its
body is specialized in place. The loop that totals the cart becomes a residual loop over the items, and the
digit-grouping loop inside <code>formatMoney</code> stays as a small residual function. Everything else is arithmetic
and string building.</p>

${reactExample("react-cart", {
  file: "CartSummaryAside, CartLineItem",
  caption: "The cart summary: two contexts, a <code>useMemo</code> over the cart, locale-aware money formatting and a list of line items.",
  ranges: [
    ["var _1 = function (data) {", "var _A7 = function (_$4V, _$4W) {"],
    ['return "<li class=\\"ns-cart-item', "};"],
    ["var _$0 = data.locale;", "var _$V = _$T + _$U;"],
    ["var _$4R = _9a(_$O, true);", 'return "<aside class=', 1],
  ],
})}

<h4 id="react-filters"><code>useId</code> inside nested lists</h4>

<p>React 18’s ids depend on a component’s position in the tree, and they have to match React’s format exactly.
Outside a list the position is known at build time, so <code>:R0:</code> and <code>:R0H1:</code> are folded straight into
the HTML. Inside a list of unknown length it isn’t, so the generated code carries React’s tree-id arithmetic and
computes each option’s <code>:R…:</code> id at runtime. Boolean attributes (<code>disabled</code>, <code>hidden</code>,
and <code>checked</code> from <code>defaultChecked</code>) become conditional pieces of the attribute string.</p>

${reactExample("react-filters", {
  file: "FilterSidebar, FilterGroup, FilterOption",
  caption: "The filter sidebar: groups of checkboxes, each with a <code>useId</code> label, nested in two lists of unknown length.",
  ranges: [
    ["var _1 = function (data) {", "var _$N = _$L.value;"],
    ["var _2w = _4d(15, _$6, _$9);", 'return "<aside class=', 1],
  ],
})}

<h4 id="react-banner">Fragments, text separators and raw HTML</h4>

<p><code>dangerouslySetInnerHTML</code> is inserted as is, without escaping. The keyed fragments in the breadcrumb list
flatten into adjacent <code>&lt;li&gt;</code> elements, and the <code>{" "}(Min. order …)</code> text run gets the
<code>&lt;!-- --&gt;</code> separators React emits between adjacent text nodes. A <code>null</code> promo removes the
whole section.</p>

${reactExample("react-banner", {
  file: "AnnouncementBanner, Breadcrumbs",
  caption: "An announcement banner with raw HTML and a minimum-order note, and a breadcrumb list built from keyed fragments.",
  ranges: [
    ["var _2z = function (_$m, _$n) {", "};"],
    ["var _$0 = data.locale;", "var _$8 = _8.minOrder;"],
    ["var _$h = _8.code;", "return (_$1 === null", 1],
  ],
})}

<p>The per-component timings are in-process, warm, on a shared machine, and the schema check validates the whole
request on every call, which dominates for one small component. The page-level numbers below are the meaningful
ones. On the full page, over the benchmark’s fixed 500-input check corpus, the output is byte-identical to
<code>ReactDOMServer.renderToString</code> (re-checked for this article: 500/500). It renders 4–5.5× faster than React
with the JIT and about 9–10× faster with <code>--jitless</code>, within 1.4–2× of a page specialized by hand. Data
that doesn’t match the inferred schema falls back to React.</p>

<p class="table-caption w">Renders per second relative to <code>ReactDOMServer.renderToString</code>, same machine, same run
(<code>react-bench/perf.js</code>, November 5, 2026). Small pages are about 6 KB of HTML, large ones about 285 KB.</p>
<div class="table-wrap w"><table class="react-perf">
<thead><tr><th scope="col"></th><th scope="col">JIT, small</th><th scope="col">JIT, large</th><th scope="col">jitless, small</th><th scope="col">jitless, large</th></tr></thead>
<tbody>
<tr><th scope="row">React <code>renderToString</code></th><td>1.00×</td><td>1.00×</td><td>1.00×</td><td>1.00×</td></tr>
<tr><th scope="row">Revived Prepack</th><td>5.39×</td><td>4.10×</td><td>8.96×</td><td>10.08×</td></tr>
<tr class="muted-row"><th scope="row">Hand-written specialization</th><td>8.42×</td><td>6.51×</td><td>18.53×</td><td>17.45×</td></tr>
</tbody></table></div>

<p>The generated program is 83.8 KB (20.6 KB gzipped) and doesn’t load React at all. The
<a href="https://jamesbox.exe.xyz/northstar/">Northstar Supply demo</a> serves the same page rendered by plain React
and by the specialized code.</p>

<h4 id="react-limits">What still breaks</h4>

<p>Two app shapes still produce broken output; both turned up while building the Northstar store. One is a list reached
through an object that may be <code>null</code> (<code>listing.products</code>, where <code>listing</code> is either
<code>null</code> or an object). The other is a loop and a <code>.map</code> over the same array inside one
conditional branch. In both cases Prepack doesn’t recognize the array as a list of unknown length, falls back to a
generic path that is broken, and the build still succeeds. The generated code contains a residual
<code>__bailout</code> call and throws on the requests that render the list. It never returns wrong HTML, but the
compiler should refuse instead of shipping code that throws. The Northstar store works around both by keeping its
collections at the top level of the data and computing listing stats outside the view branch.</p>

<figure class="cmp cols-2"><figcaption>Both shapes, compiled from 200 synthetic training requests and run on 200 more
(<code>site/scripts/run-react-examples.js</code>).</figcaption><div class="panes">
${["limit-nullable-list", "limit-loop-and-map"]
  .map(id => {
    const l = reactExamples[id];
    return `<div class="pane" data-status="wrong"><div class="pane-head"><span class="pane-label">Input</span><span class="pane-sub">${
      id === "limit-nullable-list" ? "a list behind a nullable object" : "a loop and a map in one branch"
    }</span></div><div class="pane-status"><span class="st-icon" aria-hidden="true">✗</span> Builds, then throws on ${l.threw} of ${
      l.inputs
    } requests (<code>${esc(l.firstError)}</code>); ${l.identical} render correctly</div>${code(l.source, { cls: "wrap" })}</div>`;
  })
  .join("")}
</div></figure>
`;
};
