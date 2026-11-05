// hard: P4
// source: fuzzer (extended mode, seed 1216)
// goal: `x++` on an abstract value of unknown type must apply ToNumeric; Prepack emits `x + 1`, which concatenates for strings
(function() {
  "use strict";

  function main(a1) {
    a1++;
    return a1;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(0), main("0"), main("a"), main(null), main(undefined), main(true)].map(String).join(",");
};
