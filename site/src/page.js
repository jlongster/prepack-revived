// The page shell shared by both articles: top bar, contents panel, part openers, footer,
// and copying of the shared assets (style, script, fonts) next to the page.
"use strict";
const fs = require("fs");
const path = require("path");

const SITE = path.join(__dirname, "..");

function collectSubs(parts) {
  for (const p of parts) {
    p.subs = [];
    p.body.replace(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g, (_, id, text) => {
      p.subs.push({ id, text: text.replace(/<[^>]+>/g, "") });
    });
  }
}

function contentsList(parts) {
  return `<nav class="contents" aria-label="Contents">
    <h2 class="contents-title">Contents</h2>
    <ol>${parts
      .map(
        p =>
          `<li><a href="#${p.id}"><span class="toc-num">${p.num}</span><span class="toc-title">${p.title}</span><span class="toc-deck">${p.deck}</span></a></li>`
      )
      .join("")}</ol>
  </nav>`;
}

function render(opts) {
  const parts = opts.parts;
  collectSubs(parts);
  const toc = parts
    .map(
      p => `<li><a href="#${p.id}"><span class="toc-num">${p.num}</span>${p.short}</a>${
        p.subs.length ? `<ol>${p.subs.map(s => `<li><a href="#${s.id}">${s.text}</a></li>`).join("")}</ol>` : ""
      }</li>`
    )
    .join("");
  const sections = parts
    .map(
      p => `
<section class="part grid" id="${p.id}" aria-labelledby="${p.id}-title">
  <header class="opener">
    <p class="part-num" aria-hidden="true">${p.num}</p>
    <div class="opener-text">
      <p class="part-label">${p.label || (p.num === "A" ? "Appendix" : "Part " + p.num)}</p>
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
<title>${opts.title}</title>
<meta name="description" content="${opts.description}">
<meta property="og:title" content="${opts.title}">
<meta property="og:description" content="${opts.ogDescription || opts.description}">
<meta name="color-scheme" content="light dark">
<link rel="preload" href="assets/fonts/source-serif-4-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/ibm-plex-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<a class="skip" href="#${parts[0].id}">Skip to the article</a>
<header class="topbar">
  <a class="topbar-title" href="#top">${opts.title}</a>
  <span class="topbar-section" aria-live="polite"></span>
  <button class="toc-button" aria-expanded="false" aria-controls="toc-panel">Contents</button>
  <div class="progress" aria-hidden="true"><span></span></div>
</header>
<nav id="toc-panel" class="toc-panel" aria-label="Table of contents" hidden>
  <ol>${toc}</ol>
</nav>
<main id="top">
${opts.cover(contentsList(parts))}
${sections}
</main>
<footer class="site-footer">
  <p>${opts.footer}
  Type: Source Serif 4, IBM Plex Sans and IBM Plex Mono (SIL Open Font License), served from this site.</p>
</footer>
<script src="assets/app.js" defer></script>
</body>
</html>
`;

  const out = opts.out;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "assets/fonts"), { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), html);
  fs.copyFileSync(path.join(SITE, "src/style.css"), path.join(out, "assets/style.css"));
  fs.copyFileSync(path.join(SITE, "src/app.js"), path.join(out, "assets/app.js"));
  for (const f of fs.readdirSync(path.join(SITE, "assets/fonts"))) {
    fs.copyFileSync(path.join(SITE, "assets/fonts", f), path.join(out, "assets/fonts", f));
  }
  console.log(`wrote ${path.join(out, "index.html")} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
}

module.exports = { render };
