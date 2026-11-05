// hard: P5
// source: new
// goal: lengths of conditional strings form a range; comparisons on them fold where decidable
function f(c, d) {
  var s = c ? "ab" : "abc";
  var t = d ? s + "!" : s;
  return (t.length > 1) + "," + t.length;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(true, true), f(false, false), f(1, 0)].join("|");
};
