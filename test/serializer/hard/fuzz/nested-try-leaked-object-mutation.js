// hard: P3
// source: fuzzer (extended mode, seed 535799138)
// goal: nested residual try/catch/finally must leak outer objects leaked by an inner try before the outer try so catching an exception from finally does not undo inner writes
(function() {
  "use strict";

  function main(a1, a2) {
    var o = {};
    try {
      try {
        o[0] = 7;
        a2 * 0;
      } finally {
        a1.slice(0);
      }
    } catch (e) {}
    return o;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return JSON.stringify([main(5, "10"), main([1], "2")]);
};
