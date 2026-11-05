var n = global.__abstract ? __abstract("number", "(9)") : 9;
function isEven(k) {
  return k === 0 ? true : isOdd(k - 1);
}
function isOdd(k) {
  return k === 0 ? false : isEven(k - 1);
}
var r = isEven(n) ? "even" : "odd";

inspect = function() {
  return r;
};
