// hard: P4
// source: fuzzer (extended mode, seed 75102733)
// goal: conditional simplification must not hoist a branch expression that transitively depends on a conditional temporal out of its branch guard
(function() {
  "use strict";

  function touch(p) {
    return [p.a];
  }

  function main(a1) {
    switch (isNaN(a1)) {
      case false:
        a1 = 0 % a1 || a1;
      default:
        if (!a1) return 0;
      case 0:
        touch(a1);
    }
    if (a1 !== 0) {
      if (a1) throw 99;
    }
    return 1;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [[1, 2], 0, 5, NaN]
    .map(function(v) {
      try {
        return String(main(v));
      } catch (e) {
        return "throw:" + e;
      }
    })
    .join(",");
};
