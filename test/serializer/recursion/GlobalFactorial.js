// does not contain:n - 7
var k = global.__abstract ? __abstract("number", "(6)") : 6;
function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
var r = k > 3 ? fact(k) : -1;
var t = typeof r;

inspect = function() {
  return r + " " + t;
};
