// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2319 (parseInt)
// goal: parseInt on an abstract string is pure; config object stays known; no FatalError
function f(s) {
  var cfg = { base: 10, fallback: -1 };
  var v = parseInt(s, cfg.base);
  return (v !== v ? cfg.fallback : v) + cfg.base;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return ["42", "x", "7px"].map(f).join(",");
};
