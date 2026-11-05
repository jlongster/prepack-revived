// hard: P6
// source: fuzzer (extended mode, seed 16979)
// goal: unused `in` expression in __optimize must still throw TypeError when RHS is not an object
(function() {
  "use strict";

  function main(c, x) {
    if (c) {
      0 in 0;
    } else {
      0 in x;
    }
    return 1;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var cases = [[true, {}], [false, 0], [false, null], [false, { 0: 1 }], [false, {}]];
  return cases
    .map(function(c) {
      try {
        return String(main(c[0], c[1]));
      } catch (e) {
        return "throw:" + e.name;
      }
    })
    .join(",");
};
