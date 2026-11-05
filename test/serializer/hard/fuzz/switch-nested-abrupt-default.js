// hard: P3
// source: fuzzer (extended mode, seed 225318)
// goal: no invariant in SwitchStatement.js DefiniteCaseEvaluation for a switch with fall-through calling a helper whose default case contains a throwing switch
(function() {
  "use strict";

  function boom() {
    throw new Error("boom");
  }

  function h(p) {
    switch (p) {
      case 0:
        break;
      default:
        switch (boom()) {
        }
    }
  }

  function main(a1, a2, a3, a4) {
    if (a2) return 0;
    switch (a3) {
      case undefined: {
        var x6;
        break;
      }
      case 0:
        x6 = [h(a1)] + a4.charAt(0);
      default:
        if (x6 || a2) h(1);
    }
    return x6;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var cases = [
    [0, true, 0, "a"],
    [0, false, undefined, "a"],
    [0, false, 0, "abc"],
    [1, false, 0, "abc"],
    [0, false, 9, "abc"],
  ];
  return cases
    .map(function(c) {
      try {
        return String(main(c[0], c[1], c[2], c[3]));
      } catch (e) {
        return "throw:" + e.message;
      }
    })
    .join(",");
};
