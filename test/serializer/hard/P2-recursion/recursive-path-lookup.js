// hard: P2
// source: new
// goal: recursion driven by an abstract path array (lodash get); residual recursion; correct
function get(obj, path, i) {
  if (obj == null) return undefined;
  if (i === path.length) return obj;
  return get(obj[path[i]], path, i + 1);
}
function lookup(obj, path) {
  var v = get(obj, path, 0);
  return v === undefined ? "default" : v;
}
if (global.__optimize) __optimize(lookup);

inspect = function() {
  var o = { a: { b: { c: 42 } } };
  return [lookup(o, ["a", "b", "c"]), lookup(o, ["a", "x", "c"]), lookup(o, [])].map(String).join(",");
};
