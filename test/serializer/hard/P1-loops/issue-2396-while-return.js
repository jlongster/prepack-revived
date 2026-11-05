// hard: P1
// source: variant of https://github.com/facebookarchive/prepack/issues/2396
// goal: residual while loop whose result flows into the return value; no FatalError
function f(a) {
  while (a > 10) {
    a--;
  }
  return a * 3;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(15), f(3), f(10.5)].join(",");
};
