// does not contain:x - 5
var n = global.__abstract ? __abstract("number", "(7)") : 7;
function fib(x) {
  return x <= 1 ? "" + x : fib(x - 1) + "," + fib(x - 2);
}
var s = fib(n);
var len = s.length;

inspect = function() {
  return s + " " + len;
};
