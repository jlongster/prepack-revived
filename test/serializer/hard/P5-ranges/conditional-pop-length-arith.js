// hard: P5
// source: new
// goal: arithmetic on an abstract length in a small range after conditional pop/shift; correct
function f(n) {
  var a = [1, 2, 3, 4];
  if (n > 0) a.pop();
  if (n > 1) a.shift();
  return a.length * 2 + ":" + a.join("");
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(0), f(1), f(2)].join(",");
};
