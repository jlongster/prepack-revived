"use strict";

const STATUS = { PASS: "Pass", BLOAT: "Too large", CRASH: "Error", WRONG: "Wrong" };

module.exports = c => {
  const { scoreboard, esc } = c;
  const orig = Object.fromEntries(scoreboard.orig.results.map(t => [t.test, t]));
  const rows = scoreboard.revived.results
    .map(t => {
      const o = orig[t.test];
      const cell = x => `<td class="s s-${x.status.toLowerCase()}" title="${esc(x.detail || "")}">${STATUS[x.status]}</td>`;
      return `<tr><th scope="row"><code>${esc(t.test)}</code></th>${cell(o)}${cell(t)}<td class="detail">${esc(
        o.status === "PASS" ? "" : o.detail || ""
      )}</td></tr>`;
    })
    .join("");
  return `
<h3 id="methods">How this page was made</h3>

<p>Every code panel shows the unedited output of a real tool run, produced by
<code>site/scripts/run-examples.js</code> from the inputs in <code>site/examples/</code>. Long outputs are trimmed only
where a panel says so, and long lines in the two React panels wrap; the Prepack fragment there also has line breaks
added at <code>?</code> and <code>:</code>. The script then runs the original program and each output in a fresh Node process and
evaluates the expression shown in the “Run” table, so every “differs” mark is measured.</p>

<ul class="methods">
  <li><strong>Prepack 0.2.54</strong>: the last published release (October 8, 2018), from npm:
  <code>node node_modules/prepack/lib/prepack-cli.js input.js</code>.</li>
  <li><strong>Revived Prepack</strong>: branch <code>revive</code> of the project repository, built with
  <code>yarn build</code>: <code>node lib/prepack-cli.js input.js</code>, Z3 4.16 installed (used by default).</li>
  <li><strong>Hybrid</strong>: branch <code>hybrid</code>, <code>node hybrid/bin/hybrid.js input.js</code>.</li>
  <li>Everything ran on Node v26.7.0 on Linux x64, on November 5, 2026. Prepack runs with <code>TZ=UTC</code>.</li>
  <li>The corpus results below come from <code>node scripts/hard-scoreboard.js</code> run against each build on the same
  194 programs. The serializer suite count (3,744 of 3,744) is from <code>yarn test-serializer</code> on the same build.</li>
  <li>Quotes were copied from the GitHub and Hacker News APIs; each links to the specific comment, issue, gist or
  source line. Intermediate scoreboard milestones and the fuzzing, Z3 and size statistics come from the track notes in
  <code>docs/revive/</code>.</li>
</ul>

<h3 id="all-cases">All 194 hard cases</h3>

<p>Folder names give the problem (P1–P9), <code>fuzz/</code> holds minimized fuzzer findings, and the
<code>real-world</code> folders hold library excerpts. Hover a status for the scoreboard’s detail; the last column is
0.2.54’s first diagnostic or mismatch.</p>

<details class="all-cases w">
<summary>Show the table (194 rows)</summary>
<div class="table-wrap"><table class="cases">
<thead><tr><th scope="col">Case</th><th scope="col">0.2.54</th><th scope="col">Revived</th><th scope="col">0.2.54 detail</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
</details>
`;
};
