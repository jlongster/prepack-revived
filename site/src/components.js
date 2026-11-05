// HTML building blocks for the article: code comparison panels, quotes, notes and charts.
"use strict";
const fs = require("fs");
const path = require("path");
const { highlight, escapeHtml: esc } = require("./highlight.js");
const { quotes } = require("./quotes.js");

const DATA = path.join(__dirname, "..", "data");
const examples = JSON.parse(fs.readFileSync(path.join(DATA, "examples.json"), "utf8"));
const scoreboard = JSON.parse(fs.readFileSync(path.join(DATA, "scoreboard.json"), "utf8"));
const react = JSON.parse(fs.readFileSync(path.join(DATA, "react.json"), "utf8"));
const reactExamples = JSON.parse(fs.readFileSync(path.join(DATA, "react-examples.json"), "utf8"));

const LABELS = {
  input: "Input",
  orig: "Prepack 0.2.54",
  revived: "Revived Prepack",
  hybrid: "freezedry",
};
const SUBLABELS = {
  orig: "the last release, 2018",
  revived: "this project",
  hybrid: "run, capture, emit",
};

// ---------------------------------------------------------------------------------------------
// Code

function code(src, opts = {}) {
  const lang = opts.lang || "js";
  const body = lang === "text" ? esc(src) : highlight(src);
  return `<pre class="code${opts.cls ? " " + opts.cls : ""}"><code>${body}</code></pre>`;
}

// Trims a long output for display. Returns a list of {text} and {gap} pieces so each kept piece
// is highlighted on its own and the omission is shown outside the code.
function trimPieces(src, t) {
  let lines = src.replace(/\s+$/, "").split("\n");
  let cut = 0;
  if (t && t.cols) {
    lines = lines.map(l => {
      if (l.length <= t.cols) return l;
      cut++;
      return l.slice(0, t.cols) + ` /* … ${(l.length - t.cols).toLocaleString("en-US")} more characters */`;
    });
  }
  if (t && t.head !== undefined && lines.length > t.head + (t.tail || 0) + 2) {
    const tail = t.tail || 0;
    return {
      pieces: [
        { text: lines.slice(0, t.head).join("\n") },
        { gap: lines.length - t.head - tail },
        ...(tail ? [{ text: lines.slice(lines.length - tail).join("\n") }] : []),
      ],
      trimmed: true,
      total: lines.length,
    };
  }
  return { pieces: [{ text: lines.join("\n") }], trimmed: cut > 0, total: lines.length };
}

function trimmedCode(src, t) {
  const r = trimPieces(src, t);
  const html = r.pieces
    .map(p =>
      p.gap !== undefined
        ? `<div class="gap" role="note">… ${p.gap.toLocaleString("en-US")} lines omitted …</div>`
        : `<pre class="code"><code>${highlight(p.text)}</code></pre>`
    )
    .join("");
  return { html, trimmed: r.trimmed, total: r.total };
}

function same(a, b) {
  return a && b && a.ok === b.ok && a.value === b.value;
}

function status(ex, tool) {
  const t = ex.tools[tool];
  const probes = ex.probes || [];
  const wrong = probes.some(p => p[tool] && !same(p[tool], p.original));
  const right = probes.length > 0 && probes.every(p => p[tool] && same(p[tool], p.original));
  if (t.timedOut) return { kind: "fail", text: `No output: killed after ${Math.round(t.ms / 1000)} s, still unrolling` };
  if (t.exitCode !== 0) {
    if (!t.stdout.trim()) return { kind: "fail", text: "Fails with an error" };
    if (wrong) return { kind: "wrong", text: "Reports an error, prints wrong code anyway" };
    return { kind: "fail", text: "Reports an error (exit 1), then prints its fallback" };
  }
  if (/\bbailout\b/.test(t.stderr)) return { kind: "fail", text: "Bails out: emits the original code" };
  if (wrong) return { kind: "wrong", text: /Warning/.test(t.stderr) ? "Succeeds with a warning: wrong result" : "Succeeds: wrong result" };
  if (right) return { kind: "ok", text: "Succeeds: same result as the original" };
  return { kind: "ok", text: "Succeeds" };
}

function diagBlock(stderr, maxLines = 6) {
  const lines = stderr.replace(/\s+$/, "").split("\n").filter(l => l.trim() !== "");
  if (!lines.length) return "";
  const shown = lines.slice(0, maxLines);
  const more = lines.length - shown.length;
  return `<div class="diag"><span class="diag-label">stderr</span><pre>${esc(shown.join("\n"))}${
    more > 0 ? `\n<span class="gap-inline">… ${more} more lines</span>` : ""
  }</pre></div>`;
}

const ICON = { ok: "✓", wrong: "✗", fail: "–" };

// A side-by-side comparison: the input and each tool's verbatim output, with the measured runs.
function example(id, opts = {}) {
  const ex = examples[id];
  if (!ex) throw new Error("unknown example " + id);
  const tools = opts.tools || Object.keys(ex.tools);
  const cols = 1 + tools.length;
  let trimmedAny = false;
  const panes = [];
  panes.push(
    `<div class="pane pane-input"><div class="pane-head"><span class="pane-label">${LABELS.input}</span><span class="pane-file">${esc(
      ex.inputName
    )}</span></div>${code(ex.input.replace(/\s+$/, ""))}</div>`
  );
  for (const tool of tools) {
    const t = ex.tools[tool];
    const st = status(ex, tool);
    const tc = t.stdout.trim() ? trimmedCode(t.stdout, (opts.trim || {})[tool]) : null;
    if (tc && tc.trimmed) trimmedAny = true;
    const body = tc ? tc.html : `<div class="no-output">No output</div>`;
    const meta = `${t.stdout.trim() ? (tc.total || 0).toLocaleString("en-US") + " lines · " + Buffer.byteLength(t.stdout).toLocaleString("en-US") + " bytes · " : ""}exit ${
      t.exitCode === null ? "killed" : t.exitCode
    } · ${(t.ms / 1000).toFixed(1)} s`;
    panes.push(
      `<div class="pane pane-${tool === "hybrid" ? "freezedry" : tool}" data-status="${st.kind}"><div class="pane-head"><span class="pane-label">${LABELS[tool]}</span><span class="pane-sub">${
        SUBLABELS[tool]
      }</span></div><div class="pane-status"><span class="st-icon" aria-hidden="true">${ICON[st.kind]}</span> ${esc(st.text)}</div>${body}${
        opts.stderr === false ? "" : diagBlock(t.stderr, (opts.stderrLines || {})[tool])
      }<div class="pane-meta">${meta}</div></div>`
    );
  }
  const probeRows = (ex.probes || [])
    .map(p => {
      const cells = tools
        .map(tool => {
          const r = p[tool];
          const dl = ` data-label="${LABELS[tool]} output"`;
          if (!r) return `<td class="na"${dl}>no program</td>`;
          const ok = same(r, p.original);
          return `<td class="${ok ? "eq" : "ne"}"${dl}><code>${esc(r.value)}</code>${ok ? "" : ' <span class="ne-mark">✗ differs</span>'}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${esc(p.label)}</th><td class="orig-val" data-label="Original program"><code>${esc(p.original.value)}</code></td>${cells}</tr>`;
    })
    .join("");
  const probes = probeRows
    ? `<div class="runs"><table><thead><tr><th scope="col">Run</th><th scope="col">Original program</th>${tools
        .map(t => `<th scope="col">${LABELS[t]} output</th>`)
        .join("")}</tr></thead><tbody>${probeRows}</tbody></table></div>`
    : "";
  const caption = opts.caption
    ? `<figcaption>${opts.caption}${trimmedAny ? ' <span class="trim-note">Long outputs are trimmed where marked; nothing else is edited.</span>' : ""}</figcaption>`
    : "";
  return `<figure class="cmp cols-${cols}${opts.wide ? " wide" : ""}" id="ex-${id}">${caption}<div class="panes">${panes.join("")}</div>${probes}</figure>`;
}

// Keeps only the given line ranges of a generated program. Each range is [start, end, extra]:
// the first line (after the previous range) containing `start`, through the first line containing
// `end`, plus `extra` more lines. Omitted runs are shown as gaps outside the code.
function excerpt(src, ranges, opts = {}) {
  const lines = src.replace(/\s+$/, "").split("\n");
  const keep = [];
  let from = 0;
  for (const [start, end, extra] of ranges) {
    const i = lines.findIndex((l, k) => k >= from && l.includes(start));
    if (i < 0) throw new Error("excerpt: start not found: " + start);
    const j = lines.findIndex((l, k) => k >= i && l.includes(end));
    if (j < 0) throw new Error("excerpt: end not found: " + end);
    keep.push([i, j + (extra || 0)]);
    from = j + (extra || 0) + 1;
  }
  const gap = n => `<div class="gap" role="note">… ${n.toLocaleString("en-US")} lines omitted …</div>`;
  let html = "";
  let pos = 0;
  for (const [i, j] of keep) {
    if (i > pos) html += gap(i - pos);
    const chunk = lines.slice(i, j + 1);
    const indent = Math.min(...chunk.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
    html += `<pre class="code excerpt${opts.wrap ? " wrap" : ""}"><code>${highlight(chunk.map(l => l.slice(indent)).join("\n"))}</code></pre>`;
    pos = j + 1;
  }
  if (pos < lines.length) html += gap(lines.length - pos);
  return html;
}

// A React component next to an excerpt of the renderer Prepack generated for it.
function reactExample(id, opts) {
  const ex = reactExamples[id];
  if (!ex) throw new Error("unknown react example " + id);
  const p = ex.perf;
  const check = `Checked against <code>renderToString</code> on the benchmark’s ${ex.check.inputs} check inputs:
${ex.check.identical}/${ex.check.inputs} byte-identical, ${ex.check.fallbacks} fallbacks. This component alone renders
${p.bareSpeedup.toFixed(1)}× faster than <code>renderToString</code> (${p.speedup.toFixed(1)}× including the per-request
schema check).`;
  return `<figure class="cmp cols-2" id="ex-${id}"><figcaption>${opts.caption} ${check}</figcaption><div class="panes">
<div class="pane pane-input"><div class="pane-head"><span class="pane-label">Input</span><span class="pane-file">${esc(
    opts.file
  )}</span></div>${code(ex.root + "\n\n" + ex.input)}</div>
<div class="pane" data-status="ok"><div class="pane-head"><span class="pane-label">Revived Prepack</span><span class="pane-sub">generated renderer, trimmed</span></div><div class="pane-status"><span class="st-icon" aria-hidden="true">✓</span> ${
    ex.check.identical
  }/${ex.check.inputs} byte-identical to React</div>${excerpt(ex.code, opts.ranges, { wrap: true })}<div class="pane-meta">${ex.code
    .split("\n")
    .length.toLocaleString("en-US")} lines · ${Buffer.byteLength(ex.code).toLocaleString("en-US")} bytes in total, including the schema check · compiled in ${(
    ex.stats.compileMs / 1000
  ).toFixed(1)} s</div></div>
</div></figure>`;
}

// ---------------------------------------------------------------------------------------------
// Quotes and notes

function quote(key, opts = {}) {
  const q = quotes[key];
  if (!q) throw new Error("unknown quote " + key);
  const cls = opts.pull ? "pull" : "quote";
  const who = q.role ? `${esc(q.who)}, ${esc(q.role)}` : esc(q.who);
  return `<figure class="${cls}"><blockquote cite="${q.url}"><p>${q.text}</p></blockquote><figcaption>${who} · <a href="${
    q.url
  }">${esc(q.where)}</a></figcaption></figure>`;
}

function note(html) {
  return `<aside class="note">${html}</aside>`;
}

// ---------------------------------------------------------------------------------------------
// Charts (inline SVG; colors come from CSS custom properties)

const STATUS_ORDER = ["PASS", "BLOAT", "CRASH", "WRONG"];
const STATUS_TEXT = { PASS: "Pass", BLOAT: "Correct but too large", CRASH: "Error or crash", WRONG: "Silently wrong" };

function waffle(which, opts = {}) {
  const res = scoreboard[which].results;
  const per = opts.cols || 20;
  const s = opts.size || 10;
  const g = 3;
  const rows = Math.ceil(res.length / per);
  const w = per * (s + g) - g;
  const h = rows * (s + g) - g;
  const cells = res
    .map((t, i) => {
      const x = (i % per) * (s + g);
      const y = Math.floor(i / per) * (s + g);
      return `<rect class="w-${t.status.toLowerCase()}" x="${x}" y="${y}" width="${s}" height="${s}"><title>${esc(
        t.test
      )}: ${STATUS_TEXT[t.status]}</title></rect>`;
    })
    .join("");
  return `<svg class="waffle" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(
    opts.label || ""
  )}">${cells}</svg>`;
}

function legend() {
  return `<ul class="legend">${STATUS_ORDER.map(
    s => `<li><span class="sw w-${s.toLowerCase()}"></span>${STATUS_TEXT[s]}</li>`
  ).join("")}</ul>`;
}

function summary(which) {
  return scoreboard[which].summary;
}

// Per-folder pass counts for both builds.
function folderTable() {
  const groups = {};
  for (const which of ["orig", "revived"]) {
    for (const t of scoreboard[which].results) {
      const f = t.test.split("/")[0];
      groups[f] = groups[f] || { orig: { total: 0, PASS: 0, WRONG: 0 }, revived: { total: 0, PASS: 0, WRONG: 0 } };
      groups[f][which].total++;
      groups[f][which][t.status] = (groups[f][which][t.status] || 0) + 1;
    }
  }
  return groups;
}

// Stacked 100% bars, one per milestone (HTML, so labels stay readable at any width).
function stackedBars(rows) {
  return `<div class="bars" role="img" aria-label="Hard-case corpus results at each milestone">${rows
    .map(r => {
      const total = STATUS_ORDER.reduce((a, s) => a + r[s], 0);
      const segs = STATUS_ORDER.filter(s => r[s] > 0)
        .map(
          s =>
            `<span class="seg w-${s.toLowerCase()}" style="width:${((r[s] / total) * 100).toFixed(2)}%" title="${STATUS_TEXT[s]}: ${r[s]}">${
              r[s] / total > 0.045 ? `<span class="seg-num">${r[s]}</span>` : ""
            }</span>`
        )
        .join("");
      return `<div class="bar-row"><div class="bar-label">${esc(r.label)} <span class="muted">· ${total} cases</span></div><div class="bar">${segs}</div></div>`;
    })
    .join("")}</div>`;
}

function timeline(events) {
  return `<ol class="timeline">${events
    .map(
      e => `<li${e.key ? ' class="key"' : ""}><span class="tl-date">${esc(e.date)}</span><span class="tl-text">${e.html}</span></li>`
    )
    .join("")}</ol>`;
}

function pipeline(steps) {
  return `<ol class="pipeline">${steps
    .map(
      (st, i) =>
        `<li><span class="pnum">${i + 1}</span><span class="ptitle">${esc(st.title)}</span><span class="pline">${esc(st.lines.join(" "))}</span></li>`
    )
    .join("")}</ol>`;
}

module.exports = {
  code,
  example,
  reactExample,
  excerpt,
  reactExamples,
  quote,
  note,
  waffle,
  legend,
  summary,
  folderTable,
  stackedBars,
  timeline,
  pipeline,
  esc,
  examples,
  scoreboard,
  react,
  status,
};
