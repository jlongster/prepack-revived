"use strict";

module.exports = c => {
  const r = c.summary("revived");
  const rows = [
    ["P1 Loops", "Solved for local effects", "Residual loops with a one-iteration soundness check. Loops whose effects reach global or outer state still stop with a diagnostic: summarizing those needs whole-program reasoning, and loop behavior is undecidable in general."],
    ["P2 Recursion", "Solved", "Residual calls once recursion depends on unknown values, with effect checks; refused (PP0050) when it can’t be proven safe."],
    ["P3 Joins", "Solved", "Every known miscompile fixed; <code>switch</code> and residual <code>try/catch</code> implemented. The completion design is still fragile; a simpler representation is sketched."],
    ["P4 Path conditions", "Solved with Z3", "Solver-backed implications, a rewrite audit with zero failures, and documented limits (no IEEE-754 rounding, opaque string conversions)."],
    ["P5 Numeric facts", "Solved for small ranges", "Interval domain plus case splitting up to 8 values; wide or unbounded lengths still need relational summaries."],
    ["P6 Havoc", "Mostly", "81 built-in summaries and the outer fixed point. Aliasing between unknown parameters and untyped receivers remain conservative."],
    ["P7 Environment", "Solved, by making it explicit", "Open-world globals, generated models, guarded assumptions; zero silent miscompiles on 22 libraries × 6 profiles."],
    ["P8 Size", "Solved on the corpus", "Cost model and peepholes; no case above 2×. The UMD three-way split can still double a library when no target is given."],
    ["P9 Generators and async", "By choice, partly", "Generators finished at init and settled Promises work; a generator suspended at the end of init is refused rather than approximated."],
  ];
  return `
<p class="lede">Most of the problems that stopped Prepack turned out to be solvable, in the sense that matters: the
cases from the tracker now compile to correct, compact code, and the ones that don’t stop with a diagnostic instead of
shipping something wrong. None of them was solved by one clever idea. Each was a few thousand lines of careful work,
checked by a corpus, a fuzzer and a solver.</p>

<div class="table-wrap w"><table class="verdict">
<thead><tr><th scope="col">Problem</th><th scope="col">Verdict</th><th scope="col">What that means</th></tr></thead>
<tbody>${rows.map(([p, v, d]) => `<tr><th scope="row">${p}</th><td class="v">${v}</td><td>${d}</td></tr>`).join("")}</tbody>
</table></div>

<h3 id="unsolved">What isn’t solved</h3>

<p>Loops and recursion are undecidable in general, and the revived Prepack doesn’t pretend otherwise. It handles the
shapes whose effects it can bound and refuses the rest. Modern libraries still expose gaps in its 35,000-line spec
implementation at a steady rate, and compile times on large inputs are long (279 seconds for @babel/standalone).
Without a target environment, a UMD bundle is evaluated once per module system, which can double the output. And the
size problem is only solved in the sense Markbåge meant if output never grows: on our corpus it doesn’t, but a compiler
that evaluates code will always be able to produce more code than it was given. The cost model only decides when that
is worth it.</p>

<h3 id="when">When it is the right tool</h3>

<div class="when w">
  <div><h4>Specializing on unknown data</h4><p>A renderer for a known app, an optimized function for unknown
  arguments, an init path that depends on an environment you can describe. This is where symbolic evaluation earns its
  keep, and where the revived Prepack is strongest.</p></div>
  <div><h4>Init-heavy bundles with a code cache</h4><p>Libraries that compute tables, parse locale data or register
  plugins at load start several times faster from V8’s code cache (moment 4.3×, handlebars 3.1×), usually at about
  the original size.</p></div>
  <div><h4>Not when the engine can do it</h4><p>Node’s and V8’s own startup snapshots remain the cheapest way to skip
  initialization where they’re available, and they were the first thing our initial research found still alive from
  Prepack’s idea.</p></div>
</div>

<p>Herman Venter <a href="https://github.com/facebookarchive/prepack/issues/24#issuecomment-408696869">wrote in 2018</a> that getting Prepack to run on real browser applications would take “a lot of very
hard work and a long time,” and that shortcuts would produce something that works “only for some ill defined subset of
JavaScript.” Both halves held up. What made the hard work tractable this time was checking it: a corpus built from
the tracker’s own hard cases, a differential fuzzer, and a solver that audits every rewrite. The final count is
${r.PASS} of 194 hard cases, with zero silently wrong.</p>

<h3 id="links">Links</h3>

<ul class="links">
  <li><a href="https://github.com/jlongster/prepack-revived">github.com/jlongster/prepack-revived</a>: the code, the corpus
  (<code>test/serializer/hard/</code>), the design notes (<code>docs/revive/</code>) and this site (<code>site/</code>).
  The repository is private for now.</li>
  <li><a href="https://jamesbox.exe.xyz/northstar/">Northstar Supply</a>: the React specialization running live
  (<a href="https://github.com/jlongster/northstar-supply">source</a>).</li>
  <li><a href="https://github.com/facebookarchive/prepack">facebookarchive/prepack</a>: the original, archived.</li>
  <li><a href="https://github.com/facebookarchive/prepack/issues/2639">#2639 “Is prepack dead?”</a>: Herman Venter’s
  post-mortem.</li>
</ul>
`;
};
