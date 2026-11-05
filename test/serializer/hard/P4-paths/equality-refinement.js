// hard: P4
// source: new
// goal: inside `if (x === 3)` the value of x is known; result folds to a constant on that path; correct elsewhere
function f(x) {
  if (x === 3) return x * 2 + 1;
  if (x === "3") return x + "!";
  return typeof x;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(3), f("3"), f(4), f(null)].join(",");
};
