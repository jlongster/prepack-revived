// hard: P3
// source: fuzzer (extended mode, seed 204004)
// goal: no invariant in methods/call.js processResult when a labeled break under an abstract condition precedes a throw
(function() {
  "use strict";

  function main(a) {
    B: {
      if (a) break B;
      throw new Error("inside");
    }
    throw new Error("after");
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [true, false, 0, "x"]
    .map(function(a) {
      try {
        return main(a);
      } catch (e) {
        return "throw:" + e.message;
      }
    })
    .join(",");
};
