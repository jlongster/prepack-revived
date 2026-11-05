// cannot serialize
(function() {
  let x = global.__abstract ? __abstract("number", "(5)") : 5;
  global.r = x + 1n;
})();

inspect = function() {
  return String(global.r);
};
