// hard: P1
// source: fuzzer (extended mode, seed 219849)
// goal: no "serialized N of M" invariant in ResidualHeapSerializer when one branch pushes to an array before a while loop and the other calls join
(function() {
  "use strict";

  function main(a1, a2) {
    var r = [a2];
    if (a1) {
      r.push(0);
      var n = 0;
      while (r[0] && ++n < 2) {}
    } else {
      var o = { p0: r.join(",") };
    }
    return r.length;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(true, 1), main(true, 0), main(false, "a"), main(false, 2)].join(",");
};
