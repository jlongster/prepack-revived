"use strict";
const { ISSUE } = require("../quotes.js");

module.exports = c => {
  const { example, quote, note, timeline } = c;
  const I = n => `<a href="${ISSUE(n)}">#${n}</a>`;
  return `
<p class="lede">Prepack was Facebook’s partial evaluator for JavaScript. It took a bundle, ran the code that would
normally run when the bundle loads, and wrote out a new bundle that skips straight to the result. It launched to a lot
of excitement in 2017, powered an ambitious React compiler experiment in 2018, and was quietly set down at the end
of that year. Its authors left behind an issue tracker that is unusually candid about why: a handful of problems they
called hard, undecidable, or “a bridge too far.”</p>

<h3 id="pe">Running the program before it runs</h3>

<p>Most JavaScript bundles do a surprising amount of work before your app does anything: modules register themselves,
lookup tables get computed, configuration objects are merged, strings are joined. All of that happens on every
cold start, on every device. Prepack’s idea was to do it once, at build time.</p>

<p>The simplest example, from the original announcement, shows the whole trick. Prepack interprets the program with
its own JavaScript interpreter (written in JavaScript), and when the program is done it looks at the resulting heap
and writes JavaScript that recreates that heap directly:</p>

${example("intro-hello", { caption: "The classic demo. Every output on this page is the verbatim output of the tool named in its header, produced by <code>site/scripts/run-examples.js</code>; the table under each comparison runs the original program and each output and compares the results." })}

<p>The interesting part is what happens when the interpreter meets something it cannot know at build time, like the
current time. Prepack represents such a value as an <em>abstract value</em>, a placeholder that says “some number,
decided at runtime”, and keeps going. Everything that depends only on known values is folded away; everything that
touches an abstract value is written out as <em>residual</em> code that runs later:</p>

${example("intro-partial", { caption: "Known values are folded (<code>banner</code> becomes a constant), the unknown one (<code>Date.now()</code>) stays as residual code." })}

<div class="wn"><div class="b">
<p>That is partial evaluation: specialize a program on the part of its input you know, and leave a smaller program for
the part you don’t. For a bundle, the known part is the code itself and the environment it boots into, and the
unknown part is everything that only exists at runtime: the clock, the user, the network, the DOM.</p>

<p>Prepack also had a second mode. Wrapping a function in <code>__optimize(fn)</code> told it to specialize that
function for <em>abstract arguments</em>: run its body symbolically, with every parameter unknown, and emit a
specialized version. Most of the examples on this page use that mode, because it is where the hard problems show up
fastest.</p>
</div>${note(`<strong>Abstract value.</strong> A value Prepack can’t compute at build time, tracked symbolically
(“<code>n</code>”, “<code>a ? 1 : 0</code>”, “some string”). <strong>Residual code</strong> is what Prepack emits to compute it at runtime.`)}</div>

<h3 id="bet">A bet on startup</h3>

<p>Prepack went public on May 3, 2017. The <a href="https://news.ycombinator.com/item?id=14257744">Hacker News
thread</a> reached 836 points. The target was startup time, React Native’s in particular: a phone that has to parse
and execute megabytes of module initialization before it can show anything. The project README is explicit about
where it fits: “For initialization-heavy code, Prepack works best in an environment where JavaScript parsing is
effectively cached.”</p>

<p>That framing matters for everything that follows. Prepack specialized on the <em>initialization environment</em>:
global code that runs exactly once, in a world Prepack has to model faithfully. That world includes the ECMAScript
spec itself, the host’s globals, and the state the code builds up. Get the model wrong, and the output is wrong in
ways nobody will notice at build time.</p>

<h3 id="compiler">The React compiler</h3>

<p>In 2018 the most ambitious use of Prepack was a compiler for React components, built largely by Dominic Gannaway: give it a
component tree, and it would evaluate the components, inline them into each other, and fold away React itself where
it could. Dan Abramov audited the results in a series of issues, ${I(2140)} through ${I(2143)}, and the first one
describes the problem precisely:</p>

${quote("abramov-2140")}

<p>When Prepack could evaluate code, it produced large, unrolled output. When it couldn’t (a loop over unknown data,
a <code>map()</code> callback, a bail-out somewhere in a tree) the original component, and everything it depended on,
was dragged into the bundle alongside the compiled version.</p>

<h3 id="setdown">Set down</h3>

${timeline([
  { date: "Oct 2015", html: "Repository created at Facebook." },
  { date: "May 2017", html: `Public launch at prepack.io; <a href="https://news.ycombinator.com/item?id=14257744">836 points</a> on Hacker News.`, key: true },
  { date: "Jun 2017", html: `${I(712)}: the generators design discussion stalls.` },
  { date: "Nov 2017", html: `${I(1174)} “Compute fixed points for loops” is opened. It is still open.` },
  { date: "Jun 2018", html: `Dan Abramov’s React bloat audit, ${I(2140)}–${I(2143)}.` },
  { date: "Oct 2018", html: "Last release, 0.2.54.", key: true },
  { date: "Dec 2018", html: "README: work “temporarily set down.”" },
  { date: "Feb 2020", html: `${I(2639)} “Is prepack dead?” Herman Venter’s post-mortem.`, key: true },
  { date: "Dec 2020", html: `Abramov on <a href="https://news.ycombinator.com/item?id=25499545">Hacker News</a>.` },
  { date: "Feb 2022", html: "Repository archived with 192 open issues.", key: true },
  { date: "Nov 2026", html: "This revival.", key: true },
])}

<p>The last release, 0.2.54, shipped on October 8, 2018. On December 27 the README gained a status line: “We, the
Prepack team at Facebook, have temporarily set down work on Prepack including the React compiler project.” The
clearest accounts of why come from three people who worked on it.</p>

${quote("markbage-gist", { pull: true })}

<p>Sebastian Markbåge’s “trajectory” is output size: compiled output that grows faster than the code it replaces.
Dan Abramov made the same point about bail-outs, and drew the lesson that shaped React Server Components and the
deliberately narrow React Compiler that eventually shipped:</p>

${quote("abramov-hn")}

<p>Herman Venter, who led Prepack, answered the “Is prepack dead?” issue in February 2020 with a short post-mortem.
It is worth reading in full; three sentences carry most of it:</p>

${quote("venter-2639-whole")}
${quote("venter-2639-babel")}
${quote("venter-2639-flow")}

<h3 id="eight">Eight hard problems</h3>

<p>Beyond the strategic reasons, the code and the tracker document specific technical problems the team never
solved. We grouped them into eight, and they became the work plan for everything that follows. Here they are in the
developers’ own words.</p>

<div class="problems">
  <section class="problem" id="p1">
    <h4><span class="pn">P1</span> Loops with unknown trip counts</h4>
    <p>Prepack could only unroll loops. When the bound was unknown it gave up, or after
    <a href="${c.SRC("src/evaluators/ForStatement.js", 172)}">six speculative iterations</a> failed.
    ${I(1174)} (“Compute fixed points for loops”) was opened in 2017 and never closed.</p>
    ${quote("tillmann-2055")}
    ${quote("venter-1722")}
  </section>
  <section class="problem" id="p2">
    <h4><span class="pn">P2</span> Recursion under unknown conditions</h4>
    <p>Recursion was unrolled to the maximum stack depth. The summarization that should have stopped it was
    <a href="${c.SRC("src/methods/call.js", 400)}">switched off</a> (${I(1586)}). The most-upvoted bug in the tracker,
    ${I(543)} with 121 reactions, is a one-line change that turned a recursive call into 1,065 lines of output.</p>
    ${quote("tillmann-1586")}
  </section>
  <section class="problem" id="p3">
    <h4><span class="pn">P3</span> Joining control flow</h4>
    <p><code>return</code>, <code>throw</code> and <code>break</code> under unknown conditions; <code>switch</code> on
    unknown values (labeled “level 4 (hard)” in ${I(1378)}); <code>try/catch</code> around code that might throw. The
    fuzzer the team built in 2018 found silent miscompiles here (${I(2354)}, ${I(2355)}).</p>
    ${quote("calebmer-2354")}
  </section>
  <section class="problem" id="p4">
    <h4><span class="pn">P4</span> Reasoning about path conditions</h4>
    <p>Facts like “we are inside <code>if (x != null)</code>” were tracked by a hand-written simplifier and implication
    engine, with arbitrary recursion caps. ${I(2355)}: <code>if (a) return true; return false;</code> was simplified to
    <code>return a</code>. The serializer carries a TODO that admits
    “<a href="${c.SRC("src/serializer/GeneratorTree.js", 61)}">something else going on that is not yet understood</a>”.</p>
  </section>
  <section class="problem" id="p5">
    <h4><span class="pn">P5</span> Numeric facts</h4>
    <p>After <code>if (x) a.push(42)</code>, the length of <code>a</code> is “0 or 1”. Prepack couldn’t represent
    that, so the next <code>push</code> failed (${I(1066)}).</p>
    ${quote("venter-580")}
  </section>
  <section class="problem" id="p6">
    <h4><span class="pn">P6</span> Objects escaping to unknown code</h4>
    <p>Anything passed to code Prepack couldn’t see had to be assumed modified (“havoced”), including arguments to
    harmless built-ins: ${I(2319)} counted <code>RegExp.prototype.test</code>, <code>indexOf</code>,
    <code>parseInt</code> and <code>Math.abs</code> as the top bail-outs in Facebook’s bundle. Caches that an
    optimized function fills lazily (${I(1750)}) needed what Venter called the outer fixed point:</p>
    ${quote("venter-1750")}
  </section>
  <section class="problem" id="p7">
    <h4><span class="pn">P7</span> Modeling the environment</h4>
    <p>Prepack had to know what <code>window</code>, <code>document</code>, timers and time zones do. ${I(24)} (“Add
    DOM shims”, 76 reactions) predates the launch and stayed open; the models that existed were thousands of lines,
    written by hand.</p>
    ${quote("venter-24")}
  </section>
  <section class="problem" id="p8">
    <h4><span class="pn">P8</span> Output size</h4>
    <p>The flip side of evaluating everything: unrolled loops, materialized tables, duplicated helpers. This is the
    problem Markbåge and Abramov cite as the reason the React work stopped. In our first measurement, the published
    0.2.54 made lodash about 3× larger after minification, 2× larger gzipped, and slower to load on a modern V8.</p>
  </section>
</div>

<p>One more problem sat outside the list because it is “only” spec work: modern language features. Prepack predates
<code>class</code> fields, <code>??</code> and optional chaining, and never implemented generators. The design
discussion in ${I(712)} ended with Venter’s question, which turns out to be the crux of abstract interpretation:</p>

${quote("venter-712-explode", { pull: true })}
`;
};
