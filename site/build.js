// Builds both static pages from the article sources and the measured data:
//   site/dist/            the Prepack revival article  (published to artifacts/prepack-revived/)
//   site/freezedry/dist/  the freezedry post            (published to artifacts/freezedry/)
//   node site/build.js
"use strict";
const fs = require("fs");
const path = require("path");
const c = require("./src/components.js");
const { SRC } = require("./src/quotes.js");
const { render } = require("./src/page.js");

const SITE = __dirname;
const benchFile = path.join(SITE, "data/bench.json");
const bench = fs.existsSync(benchFile) ? JSON.parse(fs.readFileSync(benchFile, "utf8")) : null;
const ctx = Object.assign({}, c, { SRC, benchSection: () => require("./src/bench.js")(c, bench) });

// ---------------------------------------------------------------------------------------------
// Prepack, revived

const parts = [
  {
    id: "part-1",
    num: "1",
    title: "Prepack and its eight hard problems",
    short: "Eight hard problems",
    deck: "A partial evaluator for JavaScript, and the problems its authors left open, in their own words.",
    body: require("./src/parts/part1.js")(ctx),
  },
  {
    id: "part-2",
    num: "2",
    title: "Reviving Prepack",
    short: "Reviving Prepack",
    deck: "Problem by problem: the technique, the key insight, what is still out of reach, and the original and revived outputs side by side.",
    body: require("./src/parts/part3.js")(ctx),
  },
  {
    id: "part-3",
    num: "3",
    title: "What we learned",
    short: "Results",
    deck: "What is solved, what isn’t, and when the revived Prepack is the right tool.",
    body: require("./src/parts/part5.js")(ctx),
  },
  {
    id: "appendix",
    num: "A",
    title: "Methods and the full scoreboard",
    short: "Appendix",
    deck: "How every number and output on this page was produced, and all 194 hard cases.",
    body: require("./src/appendix.js")(ctx),
  },
];

const o = c.summary("orig");
const r = c.summary("revived");

render({
  title: "Prepack, revived",
  description:
    "Reviving Facebook’s Prepack: attacking the problems that stopped it with AI agents, an SMT solver and a differential fuzzer.",
  ogDescription: `${o.PASS} → ${r.PASS} of 194 hard cases; ${o.WRONG} → ${r.WRONG} silently wrong. The story of reviving Facebook’s JavaScript partial evaluator.`,
  parts,
  out: path.join(SITE, "dist"),
  footer: `Built from <code>site/</code> in <a href="https://github.com/jlongster/prepack-revived">jlongster/prepack-revived</a>.`,
  cover: contents => `
<section class="cover grid" aria-labelledby="title">
  <div class="cover-text">
    <p class="kicker">A report from the Prepack revival · November 2026</p>
    <h1 id="title">Prepack, revived</h1>
  </div>
  <p class="dek">Facebook set down its JavaScript partial evaluator in 2018, leaving behind problems its own
    authors called hard, undecidable and “a bridge too far.” We went back in with AI agents, an SMT solver and a
    fuzzer. This is what worked, what didn’t, and what it cost.
    <span class="cover-links"><span>Code: <a href="https://github.com/jlongster/prepack-revived">github.com/jlongster/prepack-revived</a></span>
    <span>Live demo: <a href="https://jamesbox.exe.xyz/northstar/prepack/">a React storefront rendered by the revived Prepack</a></span></span></p>
  <figure class="cover-fig">
    <div class="waffles">
      <div class="waffle-col">
        <p class="waffle-head"><span class="big">${o.PASS}</span> of 194 pass</p>
        <p class="waffle-sub">Prepack 0.2.54 (2018) · <strong>${o.WRONG}</strong> silently wrong</p>
        ${c.waffle("orig", { label: `Prepack 0.2.54: ${o.PASS} of 194 hard cases pass, ${o.WRONG} silently wrong` })}
      </div>
      <div class="waffle-col">
        <p class="waffle-head"><span class="big accent">${r.PASS}</span> of 194 pass</p>
        <p class="waffle-sub">Revived Prepack (2026) · <strong>${r.WRONG}</strong> silently wrong</p>
        ${c.waffle("revived", { label: `Revived Prepack: ${r.PASS} of 194 hard cases pass, ${r.WRONG} silently wrong` })}
      </div>
    </div>
    ${c.legend()}
    <figcaption>Each square is one program from the hard-case corpus: a problem from Prepack’s issue tracker, a bug
    found by fuzzing, or a piece of a real library. Squares are in the same order in both grids.</figcaption>
  </figure>
  ${contents}
</section>`,
});

// ---------------------------------------------------------------------------------------------
// freezedry

require("./freezedry/article.js")(ctx, render);
