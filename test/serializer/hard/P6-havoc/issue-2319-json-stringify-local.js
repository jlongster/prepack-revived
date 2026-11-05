// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2319 (JSON.stringify, String.prototype.replace)
// goal: JSON.stringify / replace on abstract inputs are pure; local objects not havoced; correct
function f(o, s) {
  var meta = { tag: "t" };
  var json = JSON.stringify(o);
  var clean = s.replace(/-/g, "_");
  return meta.tag + json.length + clean;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f({ a: 1 }, "a-b"), f([1, 2], "--")].join(",");
};
