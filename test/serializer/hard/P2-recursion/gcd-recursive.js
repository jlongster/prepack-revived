// hard: P2
// source: new
// goal: tail recursion on abstract numbers; residual recursive (or loop) code; correct
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a, b) {
  return (a * b) / gcd(a, b);
}
if (global.__optimize) __optimize(lcm);

inspect = function() {
  return [lcm(4, 6), lcm(7, 3), lcm(10, 10)].join(",");
};
