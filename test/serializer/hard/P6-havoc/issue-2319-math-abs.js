// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2319 (Math.abs, Math.log10, Math.floor, Math.min)
// goal: Math.* on abstract numbers are pure abstract values; no leak, no FatalError
function f(x, y) {
  var r = { abs: Math.abs(x), floor: Math.floor(y), min: Math.min(x, y), lg: Math.log10(Math.abs(x) + 1) };
  return [r.abs, r.floor, r.min, r.lg.toFixed(3)].join("/");
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(-9, 2.5), f(3, -1.5)].join(",");
};
