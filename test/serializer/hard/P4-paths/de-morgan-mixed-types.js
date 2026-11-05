// hard: P4
// source: new
// goal: negations of compound conditions over non-boolean values are simplified soundly
function f(a, b) {
  if (!(a && b)) {
    if (!a || !b) return "neither-or-one:" + (a || b);
    return "impossible";
  }
  return "both:" + (a && b);
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(0, 1), f(1, 0), f(2, 3), f("", ""), f(NaN, "x")].join(",");
};
