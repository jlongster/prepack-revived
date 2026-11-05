// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2012
// goal: havoced bindings must not materialize a not-yet-available value of a sibling binding; correct
(function() {
  function f(c, d, e, g) {
    if (c) {
      var x = Date.now();
      function h() {
        return x;
      }
      g(h);
    }
    if (d) {
      var y = Date.now();
      return function() {
        let res = y;
        y = undefined;
        return res - res + x - x;
      };
    }
  }
  global.__optimize && __optimize(f);
  global.inspect = function() {
    return String(
      f(true, true, true, function(g) {
        return g();
      })()
    );
  };
})();
