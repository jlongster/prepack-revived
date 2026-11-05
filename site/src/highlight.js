// A small JavaScript highlighter run at build time. It only needs to be good enough for the
// snippets on this page: comments, strings, template literals, regex literals, numbers,
// keywords and a few literal constants. Output is escaped HTML with <span class="t-*">.
"use strict";

const KEYWORDS = new Set(
  (
    "var let const function return if else for while do break continue switch case default " +
    "throw try catch finally new delete typeof instanceof in of class extends super this " +
    "static get set async await yield import export from void with debugger"
  ).split(" ")
);
const CONSTANTS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(src) {
  let out = "";
  let i = 0;
  let prevSignificant = ""; // last non-space token, to tell a regex from a division
  const n = src.length;
  const emit = (cls, text) => {
    out += cls ? `<span class="t-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  while (i < n) {
    const c = src[i];
    const rest = src.slice(i);
    let m;
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const text = end < 0 ? src.slice(i) : src.slice(i, end);
      emit("c", text);
      i += text.length;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const text = end < 0 ? src.slice(i) : src.slice(i, end + 2);
      emit("c", text);
      i += text.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (c !== "`" && src[j] === "\n") break;
        j++;
      }
      const text = src.slice(i, j + 1);
      emit("s", text);
      i += text.length;
      prevSignificant = "str";
      continue;
    }
    if (c === "/" && /^(|[(,=:[!&|?{};+\-*%<>~^]|return|typeof|case|in|of)$/.test(prevSignificant)) {
      m = rest.match(/^\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])+\/[a-z]*/);
      if (m) {
        emit("r", m[0]);
        i += m[0].length;
        prevSignificant = "re";
        continue;
      }
    }
    if ((m = rest.match(/^(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?|\.\d+)/)) && !/[\w$]/.test(src[i - 1] || "")) {
      emit("n", m[0]);
      i += m[0].length;
      prevSignificant = "num";
      continue;
    }
    if ((m = rest.match(/^#?[A-Za-z_$][\w$]*/))) {
      const w = m[0];
      const isProp = src[i - 1] === "." && src[i - 2] !== ".";
      if (!isProp && KEYWORDS.has(w)) emit("k", w);
      else if (!isProp && CONSTANTS.has(w)) emit("n", w);
      else emit("", w);
      i += w.length;
      prevSignificant = KEYWORDS.has(w) && !isProp ? w : "id";
      continue;
    }
    if (/\s/.test(c)) {
      emit("", c);
      i++;
      continue;
    }
    emit("", c);
    prevSignificant = c === ")" || c === "]" || c === "}" ? "close" : c;
    i++;
  }
  return out;
}

module.exports = { highlight, escapeHtml };
