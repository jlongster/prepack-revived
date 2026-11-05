// hard: P2
// source: new
// goal: recursion with an abstract argument under an abstract condition in global code; residual recursive call
var k = global.__abstract ? __abstract("number", "(6)") : 6;
function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
var r = k > 3 ? fact(k) : -1;

inspect = function() {
  return String(r);
};
