// hard: P6
// source: fuzzer (extended mode, seed 202145)
// goal: no invariant in methods/get.js OrdinaryGetPartial when a dynamic write `o[k1] = undefined` stores a concrete value on unknownProperty and `o[k2]` is read
(function() {
  "use strict";

  function main(k1, k2) {
    var o = { a: 1 };
    o[k1] = undefined;
    return o[k2];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main("a", "a"), main("x", "a"), main("x", "x"), main("x", "y")].map(String).join(",");
};
