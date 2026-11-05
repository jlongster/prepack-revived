// hard: P8
// source: https://github.com/facebookarchive/prepack/issues/2140
// goal: inlining a branching helper at many call sites must not explode; output <= 2x input
function fmt(v) {
  if (v == null) return "";
  if (typeof v === "number") return v < 0 ? "(" + -v + ")" : String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v.toUpperCase) return v.length > 3 ? v.slice(0, 3) + "." : v;
  return "?";
}
function row(r) {
  return [fmt(r.a), fmt(r.b), fmt(r.c), fmt(r.d), fmt(r.e), fmt(r.f), fmt(r.g), fmt(r.h)].join("|");
}
if (global.__optimize) __optimize(row);

inspect = function() {
  return row({ a: 1, b: -2, c: true, d: "long text", e: null, f: "ab", g: {}, h: undefined });
};
