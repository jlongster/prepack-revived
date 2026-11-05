// Builds the static site into site/dist from the article sources and the measured data.
//   node site/build.js            # writes site/dist
//   node site/build.js --out DIR
"use strict";
const fs = require("fs");
const path = require("path");
const c = require("./src/components.js");
const { SRC } = require("./src/quotes.js");

const SITE = __dirname;
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(SITE, "dist");
const benchFile = path.join(SITE, "data/bench.json");
const bench = fs.existsSync(benchFile) ? JSON.parse(fs.readFileSync(benchFile, "utf8")) : null;

const ctx = Object.assign({}, c, { SRC, benchSection: () => require("./src/bench.js")(c, bench) });

const parts = [
  {
    id: "part-1",
    num: "1",
    title: "What Prepack was, and why it stopped",
    short: "What Prepack was",
    deck: "A partial evaluator for JavaScript, a bet on startup time, a React compiler, and eight problems its authors left open.",
    body: require("./src/parts/part1.js")(ctx),
  },
  {
    id: "part-2",
    num: "2",
    title: "Two ways back in",
    short: "Two approaches",
    deck: "Fix the interpreter, or stop interpreting.",
    body: require("./src/parts/part2.js")(ctx),
  },
  {
    id: "part-3",
    num: "3",
    title: "Approach A: reviving Prepack",
    short: "Reviving Prepack",
    deck: "Parallel agents, a scoreboard they couldn’t edit, a fuzzer and an SMT solver, problem by problem, with the original and revived outputs side by side.",
    body: require("./src/parts/part3.js")(ctx),
  },
  {
    id: "part-4",
    num: "4",
    title: "Approach B: run it for real",
    short: "The hybrid",
    deck: "Let V8 run the initialization code, capture the heap it built, and write JavaScript that rebuilds it, with guards for everything the build machine can’t know.",
    body: require("./src/parts/part4.js")(ctx),
  },
  {
    id: "part-5",
    num: "5",
    title: "What we learned",
    short: "Results",
    deck: "What is solved, what isn’t, and when each approach is the right tool.",
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

for (const p of parts) {
  p.subs = [];
  p.body.replace(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g, (_, id, text) => {
    p.subs.push({ id, text: text.replace(/<[^>]+>/g, "") });
  });
}

const o = c.summary("orig");
const r = c.summary("revived");

const toc = parts
  .map(
    p => `<li><a href="#${p.id}"><span class="toc-num">${p.num}</span>${p.short}</a>${
      p.subs.length ? `<ol>${p.subs.map(s => `<li><a href="#${s.id}">${s.text}</a></li>`).join("")}</ol>` : ""
    }</li>`
  )
  .join("");

const cover = `
<section class="cover grid" aria-labelledby="title">
  <div class="cover-text">
    <p class="kicker">A report from the Prepack revival · November 2026</p>
    <h1 id="title">Prepack, revived</h1>
    <p class="dek">Facebook set down its JavaScript partial evaluator in 2018, leaving behind problems its own
    authors called hard, undecidable and “a bridge too far.” We went back in with AI agents, an SMT solver and a
    fuzzer, and then tried a second, simpler idea. This is what worked, what didn’t, and what each one costs.</p>
  </div>
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
  <nav class="contents" aria-label="Contents">
    <h2 class="contents-title">Contents</h2>
    <ol>${parts
      .map(p => `<li><a href="#${p.id}"><span class="toc-num">${p.num}</span><span class="toc-title">${p.title}</span><span class="toc-deck">${p.deck}</span></a></li>`)
      .join("")}</ol>
  </nav>
</section>`;

const sections = parts
  .map(
    p => `
<section class="part grid" id="${p.id}" aria-labelledby="${p.id}-title">
  <header class="opener">
    <p class="part-num" aria-hidden="true">${p.num}</p>
    <div class="opener-text">
      <p class="part-label">${p.num === "A" ? "Appendix" : "Part " + p.num}</p>
      <h2 id="${p.id}-title">${p.title}</h2>
      <p class="deck">${p.deck}</p>
    </div>
  </header>
  ${p.body}
</section>`
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prepack, revived</title>
<meta name="description" content="Reviving Facebook’s Prepack: attacking the problems that stopped it with AI agents, Z3 and fuzzing, and a hybrid that runs initialization in V8 and emits the heap.">
<meta property="og:title" content="Prepack, revived">
<meta property="og:description" content="${o.PASS} → ${r.PASS} of 194 hard cases; ${o.WRONG} → ${r.WRONG} silently wrong. The story of reviving Facebook’s JavaScript partial evaluator.">
<meta name="color-scheme" content="light dark">
<link rel="preload" href="assets/fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/ibm-plex-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<a class="skip" href="#part-1">Skip to the article</a>
<header class="topbar">
  <a class="topbar-title" href="#top">Prepack, revived</a>
  <span class="topbar-section" aria-live="polite"></span>
  <button class="toc-button" aria-expanded="false" aria-controls="toc-panel">Contents</button>
  <div class="progress" aria-hidden="true"><span></span></div>
</header>
<nav id="toc-panel" class="toc-panel" aria-label="Table of contents" hidden>
  <ol>${toc}</ol>
</nav>
<main id="top">
${cover}
${sections}
</main>
<footer class="site-footer">
  <p>Built from <code>site/</code> in <a href="https://github.com/jlongster/prepack-revived">jlongster/prepack-revived</a>.
  Type: Source Serif 4, IBM Plex Sans and IBM Plex Mono (SIL Open Font License), served from this site.</p>
</footer>
<script src="assets/app.js" defer></script>
</body>
</html>
`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "assets/fonts"), { recursive: true });
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.copyFileSync(path.join(SITE, "src/style.css"), path.join(OUT, "assets/style.css"));
fs.copyFileSync(path.join(SITE, "src/app.js"), path.join(OUT, "assets/app.js"));
for (const f of fs.readdirSync(path.join(SITE, "assets/fonts"))) {
  fs.copyFileSync(path.join(SITE, "assets/fonts", f), path.join(OUT, "assets/fonts", f));
}
console.log(`wrote ${path.join(OUT, "index.html")} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
