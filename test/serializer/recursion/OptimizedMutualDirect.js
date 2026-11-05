function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}
function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}
if (global.__optimize) __optimize(isEven);

inspect = function() {
  return [isEven(0), isEven(5), isEven(8)].join(",");
};
