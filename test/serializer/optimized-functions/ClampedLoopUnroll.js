function runClamped(n) {
  var table = ["zero", "one", "two", "three"];
  var picked = table[n & 3];
  var k = Math.max(0, Math.min(3, n | 0));
  var acc = "";
  for (var i = 0; i < k; i++) {
    acc += i;
  }
  return picked + ":" + acc + ":" + k;
}
if (global.__optimize) __optimize(runClamped);

inspect = function() {
  return [-5, -1, 0, 1, 2, 3, 6, 99].map(runClamped).join(" | ");
};
