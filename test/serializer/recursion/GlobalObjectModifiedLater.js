// throws introspection error
(function() {
  var n = global.__abstract ? __abstract("number", "(5)") : 5;
  var config = { step: 1 };
  function count(k) {
    return k <= 0 ? 0 : 1 + count(k - config.step);
  }
  global.r = count(n);
  config.step = 2;
  global.config = config;
})();

inspect = function() {
  return global.r;
};
