// hard: P6
// source: fuzzer (extended mode, seed 201812)
// goal: no invariant in evaluators/UnaryExpression.js evaluateDeleteOperation for `delete a.p` when `a` is an abstract non-null value of unknown type
(function() {
  "use strict";

  function main(a) {
    if (a != null) delete a.p;
    return a && typeof a === "object" ? a.p : a;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(null), main(undefined), main(1), main("s"), main(true), main({ p: 9, q: 2 })].map(String).join(",");
};
