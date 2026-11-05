// hard: P5
// source: new
// goal: (n & 3) is in [0,3], so table[n & 3] is a 4-way choice over known values; no FatalError
function pick(n) {
  var table = ["zero", "one", "two", "three"];
  return table[n & 3];
}
if (global.__optimize) __optimize(pick);

inspect = function() {
  return [0, 1, 6, 7, -1].map(pick).join(",");
};
