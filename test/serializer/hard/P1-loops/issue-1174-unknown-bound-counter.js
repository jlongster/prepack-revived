// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/1174
// goal: emit a residual for-loop for an unknown trip count inside __optimize; no FatalError; output <= 2x input
function sum(n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    s += i;
  }
  return s;
}
if (global.__optimize) __optimize(sum);

inspect = function() {
  return [0, 1, 5, 10, -3].map(sum).join(",");
};
