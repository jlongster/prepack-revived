// hard: P2
// source: new
// goal: recursive deep clone of an abstract JSON-like value; residual recursive function; correct
function clone(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clone);
  var out = {};
  Object.keys(v).forEach(function(k) {
    out[k] = clone(v[k]);
  });
  return out;
}
function copyConfig(cfg) {
  var c = clone(cfg);
  c.copied = true;
  return c;
}
if (global.__optimize) __optimize(copyConfig);

inspect = function() {
  var src = { a: [1, { b: 2 }], c: "d" };
  var c = copyConfig(src);
  return JSON.stringify(c) + (c.a !== src.a) + JSON.stringify(src);
};
