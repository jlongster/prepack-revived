// hard: P3
// source: fuzzer (classic mode, seed 103023)
// goal: `x ? (y ? 0 : boom()) : "outer"` must return "outer" when x is falsy, not drop the alternate when joining PossiblyNormalCompletion
(function() {
  "use strict";

  function boom() {
    throw new Error("boom");
  }

  function main(x, y) {
    return x ? (y ? 0 : boom()) : "outer";
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var cases = [[false, false], [false, true], [0, 0], ["", 1], [true, true], [1, "yes"], [true, false]];
  return cases
    .map(function(c) {
      try {
        return String(main(c[0], c[1]));
      } catch (e) {
        return "throw:" + e.message;
      }
    })
    .join(",");
};
