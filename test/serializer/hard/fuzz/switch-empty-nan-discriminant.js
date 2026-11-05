// hard: P3
// source: fuzzer (extended mode, seed 1375)
// goal: no invariant in methods/join.js (mapAndJoin from SwitchStatement) for an empty switch on an abstract conditional with a NaN arm
(function() {
  "use strict";

  function main(a1) {
    switch (a1 ? NaN : 0) {
    }
    return a1;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(0), main(1), main("x")].join(",");
};
