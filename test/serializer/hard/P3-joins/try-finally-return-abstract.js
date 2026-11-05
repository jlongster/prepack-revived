// hard: P3
// source: new
// goal: try/finally where the try returns under an abstract condition and finally mutates state; correct
function f(c, state) {
  try {
    if (c) return "early";
    state.steps.push("body");
  } finally {
    state.steps.push("finally");
  }
  return "late";
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var s1 = { steps: [] };
  var s2 = { steps: [] };
  return f(true, s1) + s1.steps.join("+") + "," + f(false, s2) + s2.steps.join("+");
};
