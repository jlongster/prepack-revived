// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/2363
// goal: no invariant in evaluateWithAbstractConditional (PossiblyNormalCompletion); correct output
(function() {
  "use strict";

  function main(a1, a2, a3, a4) {
    var x = a1 ? (a2 ? a2 : false) : false;
    if (!x) {
      if (a3 ? x : a3) {
      } else {
        if (!a4) return;
      }
      return;
    }
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var r = [];
  for (var i = 0; i < 16; i++) r.push(String(main(i & 1, i & 2, i & 4, i & 8)));
  return r.join(",");
};
