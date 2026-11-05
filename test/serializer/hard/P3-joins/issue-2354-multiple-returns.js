// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/2354
// goal: correct join of nested returns under abstract conditions (fuzzer bug; silently wrong output)
(function() {
  "use strict";

  function main(a1, a2, a3) {
    if (a1) {
      if (a2) {
        return false;
      }
    }

    if (!a3) {
      return false;
    }

    return true;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var r = [];
  [false, true].forEach(function(a1) {
    [false, true].forEach(function(a2) {
      [false, true].forEach(function(a3) {
        r.push(main(a1, a2, a3));
      });
    });
  });
  return r.join(",") + "|" + main(0, "", NaN) + main(1, 0, "x");
};
