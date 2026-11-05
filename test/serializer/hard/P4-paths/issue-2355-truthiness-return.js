// hard: P4
// source: https://github.com/facebookarchive/prepack/issues/2355
// goal: `if (a1) return true; return false;` must not simplify to `return a1` when a1 is not boolean
(function() {
  "use strict";

  function main(a1) {
    if (a1) {
      return true;
    }
    return false;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [1, 0, "", "x", null, undefined, NaN, {}].map(main).join(",");
};
