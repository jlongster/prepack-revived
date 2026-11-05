// hard: P4
// source: fuzzer (extended mode, seed 15859)
// goal: `a != null` only excludes null and undefined, not falsy primitives (0, "", false, NaN)
(function() {
  "use strict";

  function main(a) {
    if (a == null) return "nullish";
    return a && true;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(null), main(undefined), main(0), main(""), main(false), main(NaN), main(5)].map(String).join(",");
};
