// hard: P1
// source: fuzzer (extended mode, seed 1840)
// goal: no invariant in widen() (methods/widen.js) for a for-loop nested in a do/while inside a conditionally called helper
(function() {
  "use strict";

  function h(p1, p2) {
    var i = 0;
    do {
      for (var j = p1; j; j = 0) {}
    } while (typeof p2 && ++i < 3);
  }

  function main(a1, a2) {
    if (!a2) h(a1, a2);
    return a1;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(1, 0), main(0, 1), main("x", false), main(null, "y")].join(",");
};
