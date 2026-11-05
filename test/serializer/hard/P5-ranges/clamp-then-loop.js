// hard: P5
// source: new (ranges + loops)
// goal: a loop bound clamped to [0,3] can be unrolled into at most 4 cases or residualized; no FatalError
function stars(n) {
  var k = Math.max(0, Math.min(3, n | 0));
  var s = "";
  for (var i = 0; i < k; i++) s += "*";
  return s + "|" + k;
}
if (global.__optimize) __optimize(stars);

inspect = function() {
  return [-5, 0, 2, 3, 99].map(stars).join(",");
};
