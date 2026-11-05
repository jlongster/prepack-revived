// hard: P3
// source: fuzzer (extended mode, seed 779289056)
// goal: concrete for-in and for-of loops must normalize conditional continue completions instead of leaking them into caller return joins
(function() {
  "use strict";

  function main(a) {
    var o = { p1: 0 };
    for (var k in o) {
      if (0 == a) {
        return 0;
      } else if (a) {
        continue;
      }
    }
    var sum = 0;
    for (var v of [1, 2]) {
      if (a === "stop") break;
      if (a === "skip" && v === 1) continue;
      sum += v;
    }
    return sum;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(0), main("ab"), main(""), main("stop"), main("skip")].map(String).join(",");
};
