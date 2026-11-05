// hard: P5
// source: new
// goal: writing at an index derived from a small abstract range (a[c ? 1 : 2] = v); correct array
function f(c) {
  var a = [0, 0, 0];
  a[c ? 1 : 2] = 5;
  a[a.length - 1] += 1;
  return a.join(",");
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(true), f(false)].join("|");
};
