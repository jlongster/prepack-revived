// hard: P1
// source: new
// goal: data-dependent loop with branches in the body; residual loop; no FatalError
function steps(n) {
  var count = 0;
  while (n > 1) {
    if (n % 2 === 0) n = n / 2;
    else n = 3 * n + 1;
    count++;
  }
  return count;
}
if (global.__optimize) __optimize(steps);

inspect = function() {
  return [steps(1), steps(6), steps(27)].join(",");
};
