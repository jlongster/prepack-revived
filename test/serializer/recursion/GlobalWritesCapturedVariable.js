// throws introspection error
(function() {
  var n = global.__abstract ? __abstract("number", "(5)") : 5;
  var calls = 0;
  function count(k) {
    calls++;
    return k <= 0 ? 0 : 1 + count(k - 1);
  }
  global.r = count(n);
  global.calls = calls;
})();

inspect = function() {
  return global.r + " " + global.calls;
};
