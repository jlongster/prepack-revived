// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/2396
// goal: residualize the while loop without a FatalError (PP0001 with empty message today)
function f(a) {
  while (a > 10) {
    a--;
  }
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return String(f(15)) + String(f(3));
};
