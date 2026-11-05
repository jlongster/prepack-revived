// hard: P2
// source: new
// goal: mutual recursion on an abstract number; residual functions; no unrolling to stack depth
function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}
function parity(n) {
  return isEven(n) ? "even" : "odd";
}
if (global.__optimize) __optimize(parity);

inspect = function() {
  return [parity(0), parity(7), parity(10)].join(",");
};
