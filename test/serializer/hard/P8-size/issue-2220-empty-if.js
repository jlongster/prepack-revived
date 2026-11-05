// hard: P8
// source: https://github.com/facebookarchive/prepack/issues/2220
// goal: no `if (...) {}` with empty branches for dead pure generator entries
// does not contain:{}
(function() {
  let n = global.__abstract ? __abstract("number", "23") : 23;
  if (n === 42) {
    let d = Date.now(); // dead pure generator entry
  }
})();

inspect = function() {
  return "ok";
};
