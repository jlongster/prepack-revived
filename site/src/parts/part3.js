"use strict";
const { ISSUE } = require("../quotes.js");

module.exports = c => {
  const { example, quote, note, stackedBars, folderTable, summary, react, code } = c;
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
<p class="lede">The plan was written down before any code changed: a scoreboard first, one problem per agent, and no
silent fixes. If something turned out to be impossible, the deliverable was a minimal example showing why.</p>

<h3 id="org">How the work was organized</h3>

<div class="wn"><div class="b">
<p><strong>Phase 0</strong> built the foundation in parallel. One agent revived the build (Babel 7, Flow and Jest from
2018, now on Node 26) and recorded a baseline: 3,378 of 3,378 serializer tests passing. A second turned the issue
tracker into a <em>hard-case corpus</em>: small, deterministic programs, each with a header naming the source issue
and the goal. A third revived Prepack’s fuzzer and extended it to loops, <code>switch</code>, <code>try</code>,
objects and closures.</p>

<p><strong>Phase 1</strong> ran six agents at once, one per area, each in its own git worktree: control-flow joins,
a Z3 solver bridge, a numeric range domain, built-in summaries, loops, and recursion. <strong>Phase 2</strong> added
environment models and a size cost model; then came integration, a second correctness round driven by the fuzzer,
modern-language support, real-world blockers and the React work. Every merge re-ran the same gates.</p>
</div>${note(`<strong>The scoreboard.</strong> <code>scripts/hard-scoreboard.js</code> runs every corpus program in
plain Node and through Prepack, runs both, and compares. A case is PASS only with no error, the same result, and output
at most 2× the input. WRONG means Prepack reported success and the program computes something else.`)}</div>

<p>The rule that made parallel work safe was that the scoreboard, not the agent, decides. A track’s claim counted
only if a failing case now passed, the full serializer suite still passed, and no case anywhere moved to WRONG.
Agents could add cases but never edit or weaken existing ones, and “correctness beats coverage” was written into their
instructions: when unsure, stop with a diagnostic. The coordinating session merged each branch and re-ran the gates
itself.</p>

<figure class="w chart">
${stackedBars([
  { label: "Phase 0 baseline (local build of the original)", PASS: 38, BLOAT: 16, CRASH: 63, WRONG: 16 },
  { label: "Mid-project, before the size track", PASS: 104, BLOAT: 24, CRASH: 16, WRONG: 15 },
  { label: "After the size cost model", PASS: 128, BLOAT: 1, CRASH: 15, WRONG: 15 },
  { label: "After environment modeling", PASS: 150, BLOAT: 1, CRASH: 15, WRONG: 9 },
  { label: "After correctness round 2", PASS: 187, BLOAT: 0, CRASH: 6, WRONG: 1 },
  { label: "Final", PASS: r.PASS, BLOAT: r.BLOAT, CRASH: r.CRASH, WRONG: r.WRONG },
])}
${c.legend()}
<figcaption>The hard-case corpus at each milestone. The corpus grew from 133 to 194 cases as the fuzzer and the
real-world work found new bugs, which is why WRONG did not fall in a straight line. Intermediate rows are from the
track notes in <code>docs/revive/</code>; the final row was re-measured for this article.</figcaption>
</figure>

<p>On the final 194-case corpus, the published Prepack 0.2.54 passes ${o.PASS}, crashes or reports an error on
${o.CRASH}, and is <em>silently wrong</em> on ${o.WRONG}. The revived build passes ${r.PASS}, with ${r.WRONG} wrong
and ${r.CRASH} clean errors. The serializer’s own regression suite grew from 3,378 to 3,744 test runs, all passing.
Across 22 real-world libraries and six option profiles each, the revived build produces no wrong output.</p>

<div class="table-wrap w"><table class="folders">
<thead><tr><th scope="col">Corpus folder</th><th scope="col">0.2.54 passes</th><th scope="col">wrong</th><th scope="col">Revived passes</th><th scope="col">wrong</th></tr></thead>
<tbody>${folderRows}</tbody>
<tfoot><tr><th scope="row">All 194 cases</th><td><span class="mnum">${o.PASS}/194</span></td><td class="wr">${o.WRONG}</td><td><span class="mnum">${r.PASS}/194</span></td><td class="wr">${r.WRONG}</td></tr></tfoot>
</table></div>

<p>The four remaining errors are deliberate: a test that checks the duplicate-name diagnostic, an unfrozen object
leaking from global code (reported, as the original test suite expects), a generator left suspended at the end of
initialization (see <a href="#lang">modern JavaScript</a>), and one fuzzer case that bails out cleanly with correct
recovered output. The rest of this part goes problem by problem.</p>

<h3 id="a-loops">P1 · Loops</h3>

${quote("venter-1174")}

<p>That was the plan in 2017. The loops agent implemented it as <code>residualLoop.js</code>. Prepack still tries to
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

<p>The disabled code had five structural bugs (it always aborted at the end anyway). The recursion agent replaced it
with <code>recursion.js</code>: recursion that stays concrete keeps unrolling, but as soon as a recursive call is
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

<p>The joins agent traced these to a handful of root causes: the saved-completion state was never scoped at
<code>switch</code>, labeled-statement and <code>try</code> boundaries; two simplifier rules erased boolean
conversions; a joined completion reported only its first branch’s value. It also implemented the two features the
tracker had asked for. <code>switch</code> on an unknown value (${I(1378)}, “level 4 (hard)”) now handles fall-through
and returns:</p>

${example("joins-switch-1378", {})}

<p>And <code>try/catch</code> around code that might throw, which used to be a hard error (PP0021, ${I(2120)}), is
now emitted as a residual <code>try</code>:</p>

${example("joins-try-2120", { caption: "0.2.54 reports PP0021 and prints code without the <code>catch</code>; that code throws where the original returns 42." })}

<div class="wn"><div class="b">
<p>The revived fuzzer generated 48,898 programs in its first campaigns, covering loops, labels, <code>switch</code>,
<code>try</code>, objects, arrays and closures. It found 1,260 silently wrong programs and 469 internal invariant
failures, which minimized to dozens of distinct bugs. Every one became a corpus case: 44 now live in
<code>test/serializer/hard/fuzz/</code>. On those 44, 0.2.54 is wrong on ${groups.fuzz.orig.WRONG} and crashes on
${groups.fuzz.orig.CRASH}. The revived build passes ${groups.fuzz.revived.PASS}.</p>
</div>${note(`The agent’s design note concluded that the ten completion classes should eventually be replaced by a
single map from exit kind (<code>return</code>, <code>throw</code>, <code>break label</code>…) to a guarded branch.
For this project they were patched instead: about 350 lines fixed every known bug without a rewrite.`)}</div>

<h3 id="a-paths">P4 · Path conditions, checked by Z3</h3>

<p>Prepack’s logic engine was a set of hand-written rewrite and implication rules. Rather than write better rules,
the solver agent connected a real SMT solver. Z3 runs as a persistent child process behind two named pipes, so
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

<p>The range agent added an interval domain: every numeric abstract value carries bounds, whether it is an integer,
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
kind of work an AI agent is good at and a small team never has time for: 81 built-ins now carry declarative effect
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

<p>The environment agent made three changes. Unknown globals are now <em>open-world</em>: they become residual
reads. Models for the DOM, Node and <code>Intl</code> are generated from TypeScript’s <code>lib.dom.d.ts</code> and
<code>@types/node</code> (77 interfaces, 102 DOM globals), which, as it happens, is what a commenter on ${I(24)}
suggested in 2017. And specializing on the environment is now explicit: <code>--assume</code> folds an assumption and
emits a runtime guard, with the original code as the fallback:</p>

${example("env-guard", { caption: "<code>--assume 'process.env.NODE_ENV=\"production\"' --assume timezoneOffset=0</code>. The time-zone guard checks two dates half a year apart so daylight saving time can’t pass it by accident. On a machine in India the guard fails and the original code runs." })}

<h3 id="a-size">P8 · Output size</h3>

<p>The size agent attacked bloat at three levels: serializer peepholes (dead intermediate writes, compact
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

${example("hyb-class", { tools: ["orig", "revived"], caption: "A class with private members. 0.2.54 prints a program that is a SyntaxError. (The hybrid’s output for this input is in Part 4.)" })}

<h3 id="a-bench">Real-world results</h3>

${c.benchSection()}

<h3 id="a-react">React, revisited</h3>

<p>The React compiler of 2018 tried to fold React itself. The revival took a narrower route: specialize React 18
server rendering of a <em>known</em> app for <em>unknown</em> request data. The app is a 30-component e-commerce page
(the same one behind the <a href="https://jamesbox.exe.xyz/northstar/">Northstar demo</a>); the data is a different
product listing on every request. Instead of evaluating the real <code>react-dom/server</code>, which keeps its state
in long-lived queues Prepack can’t summarize, the agent ported React’s server renderer into about 1,300 lines written
in a style Prepack <em>can</em> evaluate: every function restores what it changes. The attribute tables are copied
verbatim from react-dom 18.3.1. Prepack then specializes the whole render for a data schema inferred from training
inputs. Here is one small component and the code Prepack produced for one place it is used:</p>

<figure class="cmp cols-2"><figcaption>One component from the benchmark app (<code>app.jsx</code>) and the corresponding
fragment of the revived Prepack’s generated renderer (one expression, verbatim; the full program is 83,754 bytes). React
is gone: the result is string concatenation with the branches the data needs.</figcaption><div class="panes">
<div class="pane"><div class="pane-head"><span class="pane-label">Input</span><span class="pane-file">StockBadge in app.jsx</span></div>${code(react.component)}</div>
<div class="pane" data-status="ok"><div class="pane-head"><span class="pane-label">Revived Prepack</span><span class="pane-sub">react-ssr specialization</span></div>${code(react.prepackFragment.replace(/ \? /g, "\n  ? ").replace(/ : /g, "\n  : "), { cls: "wrap" })}<div class="pane-meta">line breaks added at <code>?</code> and <code>:</code> for reading</div></div>
</div></figure>

<p>On the benchmark’s fixed 500-input check corpus the output is byte-identical to
<code>ReactDOMServer.renderToString</code> (re-checked for this article: 500/500). It renders 4–5.5× faster than React
with the JIT and about 9–10× faster with <code>--jitless</code>, within 1.4–2× of a page specialized by hand. Data
that doesn’t match the inferred schema falls back to React. The numbers are in the <a href="#b-react">head-to-head
table</a> in Part 4, next to the hybrid’s.</p>
`;
};
