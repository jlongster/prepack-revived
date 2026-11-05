// hard: P3
// source: new
// goal: joins of objects created on different abstract paths, later mutated; correct identity and contents
function make(a, b) {
  var o;
  if (a) {
    o = { kind: "A" };
    if (b) return o;
  } else {
    o = { kind: "B" };
  }
  o.touched = true;
  var p = b ? o : { kind: "C" };
  p.extra = 1;
  return o;
}
if (global.__optimize) __optimize(make);

inspect = function() {
  return JSON.stringify([make(true, true), make(true, false), make(false, true), make(false, false)]);
};
