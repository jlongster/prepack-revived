(function() {
  var n = global.__abstract ? __abstract("number", "(5)") : 5;
  var config = { step: 2, inner: { base: 10 } };
  config.step = 1;
  function count(k) {
    return k <= 0 ? config.inner.base : 1 + count(k - config.step);
  }
  global.r = count(n);
  global.config = config;
})();

inspect = function() {
  return global.r + " " + JSON.stringify(global.config);
};
