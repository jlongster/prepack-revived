// hard: P4
// source: fuzzer (extended mode, seed 1564)
// goal: no "assuming that false equals true" invariant (utils/paths.js) when widening a loop with null/typeof/undefined checks on joined values
(function() {
  "use strict";

  function main(a1) {
    var x = a1,
      y,
      n = 0;
    do {
      if (x == null) {
        if (typeof x) {
        } else {
          y = 0;
        }
      } else if (y == 0) {
        if (y !== undefined) break;
      }
      x += y;
    } while (++n < 3);
    return x;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(1), main(null), main(undefined), main("s"), main(0)].map(String).join(",");
};
