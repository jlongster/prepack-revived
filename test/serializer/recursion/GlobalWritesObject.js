// throws introspection error
(function() {
  var n = global.__abstract ? __abstract("number", "(5)") : 5;
  var log = [];
  function count(k) {
    log.push(k);
    return k <= 0 ? 0 : 1 + count(k - 1);
  }
  global.r = count(n);
  global.log = log;
})();

inspect = function() {
  return global.r + " " + global.log.join();
};
