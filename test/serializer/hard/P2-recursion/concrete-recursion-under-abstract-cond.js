// hard: P2
// source: variant of https://github.com/facebookarchive/prepack/issues/543
// goal: recursion with concrete arguments under an abstract condition folds to a constant; the helper is dropped
// does not contain:ack(
(function() {
  var c = global.__abstract ? __abstract("boolean", "(true)") : true;
  function ack(m, n) {
    return m === 0 ? n + 1 : n === 0 ? ack(m - 1, 1) : ack(m - 1, ack(m, n - 1));
  }
  global.r = c ? ack(2, 3) : 0;
})();

inspect = function() {
  return String(global.r);
};
