var k = global.__abstract ? __abstract("number", "k0") : k0;
function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
var r = k > 3 ? fact(k) : -1;
