"use strict";

module.exports = c => `
<p class="lede">We tried two things, in parallel, and kept both. The first takes the original codebase at face value
and goes after the eight problems one at a time. The second asks whether the problems need to be solved at all.</p>

<div class="approaches">
  <section class="approach">
    <p class="approach-tag">Approach A</p>
    <h3>Revive Prepack</h3>
    <p>Start from the archived source (81k lines, about 35k of them a re-implementation of the ECMAScript spec), get it
    building on Node 26, and attack each hard problem with a dedicated AI agent working in its own branch. Give the
    agents tools the original team didn’t have: an SMT solver (Z3) for path conditions, a differential fuzzer, and a
    scored corpus of 194 hard cases taken from the issue tracker. A fix only counts if a failing case passes and nothing
    else breaks.</p>
  </section>
  <section class="approach">
    <p class="approach-tag">Approach B</p>
    <h3>The hybrid</h3>
    <p>Don’t interpret the initialization code at all: run it in the real engine (V8, via Node’s <code>vm</code> module),
    then capture the resulting heap through the inspector protocol (including closures and their shared scopes) and
    emit JavaScript that rebuilds it. Every read of the environment becomes a runtime guard with a fallback to the
    original code. For React, trace real renders and emit guarded templates.</p>
  </section>
</div>

<div class="table-wrap w"><table class="compare">
  <thead><tr><th scope="col"></th><th scope="col">A · Revived Prepack</th><th scope="col">B · Hybrid</th></tr></thead>
  <tbody>
    <tr><th scope="row">Who runs the init code</th><td>Prepack’s own interpreter</td><td>V8</td></tr>
    <tr><th scope="row">Language coverage</th><td>What the interpreter implements (now including classes, private fields, BigInt, <code>??</code>, settled Promises)</td><td>Everything the engine supports</td></tr>
    <tr><th scope="row">Unknown inputs</th><td>Symbolic: abstract values, residual loops and recursion, solver-checked path conditions</td><td>None at init; environment reads become guards. React: traces plus guards</td></tr>
    <tr><th scope="row">When it can’t do something</th><td>Stops with a diagnostic</td><td>Bails out and emits the original code</td></tr>
    <tr><th scope="row">Output size</th><td>Near the input for most libraries (gzip 0.9–1.35× on 16 of 18)</td><td>Larger: the heap is spelled out (gzip 1.5–3.7×)</td></tr>
    <tr><th scope="row">Verification</th><td>Differential runs on the corpus, fuzzing, Z3 rewrite audit</td><td>Heap-isomorphism oracle: original vs output, object by object, scope by scope</td></tr>
    <tr><th scope="row">Best at</th><td>Specializing code on unknown data</td><td>Snapshotting large, modern libraries exactly</td></tr>
  </tbody>
</table></div>
`;
