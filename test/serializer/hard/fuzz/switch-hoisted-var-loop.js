// hard: P3
// source: fuzzer (extended mode, seed 1321)
// goal: no invariant in ResidualHeapSerializer.serializeBinding for a var declared in a switch case block and read by a loop in a fall-through default
(function() {
  "use strict";

  function main(a, b) {
    switch (0) {
      case 0: {
        var i;
      }
      default:
        for (; b && i; ) {}
    }
    return [i];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(0, 0), main(1, true), main("x", "y")].map(String).join(",");
};
