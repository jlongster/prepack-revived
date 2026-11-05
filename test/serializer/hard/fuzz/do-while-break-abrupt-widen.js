// hard: P1
// source: fuzzer (extended mode, seed 1190, variant found while cleaning up the repro)
// goal: no "if a loop iteration ends abruptly, there is no need for fixed point computation" invariant (methods/widen.js widenResults) for a do/while whose body may throw or break
(function() {
  "use strict";

  function main(a) {
    var n = 0;
    do {
      var o = { p0: a.slice(0) };
      if (++n > 1) break;
    } while (a);
    return o.p0;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return ["", "ab", [1, 2], 5]
    .map(function(a) {
      try {
        return String(main(a));
      } catch (e) {
        return "throw " + e.name;
      }
    })
    .join(",");
};
