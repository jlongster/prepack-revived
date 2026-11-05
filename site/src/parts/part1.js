"use strict";
const { ISSUE } = require("../quotes.js");

module.exports = c => {
  const { example, quote } = c;
  const I = n => `<a href="${ISSUE(n)}">#${n}</a>`;
  return `
<p class="lede">Prepack is Facebook’s partial evaluator for JavaScript. It runs the code a bundle would run when it
loads, using its own interpreter, and writes out a new bundle that rebuilds the result directly. Whatever it can’t
know at build time (the clock, the user, the DOM) it tracks as an <em>abstract value</em> and leaves as
<em>residual</em> code that runs later. Facebook set it down at the end of 2018; asked in 2020 whether it was dead,
its lead <a href="${ISSUE(2639)}#issuecomment-585997029">answered</a> that “no one currently at Facebook seems to have
a scenario in mind where they believe that Prepack can be of use.”</p>

${example("intro-partial", { caption: "Partial evaluation in one example: the loop runs at build time, so the output contains only the finished table; <code>Date.now()</code> can’t be known until the app runs, so it stays in the output as code. Every output on this page is the verbatim output of the tool named in its header, produced by <code>site/scripts/run-examples.js</code>; the table under each comparison runs the original program and each output and compares the results." })}

<p>Prepack also has a second mode: <code>__optimize(fn)</code> specializes a function for <em>abstract
arguments</em>, running its body with every parameter unknown. Most examples below use it, because it is where the
hard problems show up fastest.</p>

<h3 id="eight">Eight hard problems</h3>

<p>The code and the issue tracker document the technical problems the original team never solved. We grouped them
into eight. Here they are in the developers’ own words.</p>

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
    ${quote("tillmann-520")}
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
    <p>The flip side of evaluating everything: unrolled loops, materialized tables, duplicated helpers. The published
    0.2.54 makes lodash about 3× larger after minification, 2× larger gzipped, and slower to load on a modern V8.
    Sebastian Markbåge (<a href="https://gist.github.com/sebmarkbage/a5ef436427437a98408672108df01919">gist</a>) named
    output size as “ultimately the reason we abandoned that particular approach.”</p>
    ${quote("abramov-hn")}
  </section>
</div>

<p>Modern language features sat outside the list because they are “only” spec work, but one of them
touches the core of abstract interpretation. The generators discussion in ${I(712)} stalled on suspending a
computation in the middle of exploring both sides of an unknown branch:</p>

${quote("venter-712-iterate", { pull: true })}

<p>Part 2 takes the problems one at a time: how the revived Prepack approaches each one, what is still out of reach,
and the original and revived outputs side by side. We also explored a different architecture that sidesteps the
interpreter entirely, running initialization in the real engine and emitting the heap it builds; that is written up
separately.<!-- link to freezedry post --></p>
`;
};
