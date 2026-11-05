// hard: P6
// source: variant of https://github.com/facebookarchive/prepack/issues/2179
// goal: two abstract object parameters may alias; a write through one must be visible through the other
function f(a, b) {
  a.x = 1;
  b.x = 2;
  return a.x;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var o = {};
  return [f(o, o), f({}, {})].join(",");
};
