// hard: P4
// source: new (path implication)
// goal: x > 5 implies x > 3, so the inner else branch is dead and should not be emitted
// does not contain:unreachable
function f(x) {
  if (x > 5) {
    if (x > 3) return "big";
    return "unreachable";
  }
  return "small";
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(10), f(4), f(5)].join(",");
};
