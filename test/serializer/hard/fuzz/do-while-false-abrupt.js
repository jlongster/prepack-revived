// hard: P3
// source: fuzzer (extended mode, seeds 500699, 501072 and 501448)
// goal: conditional return or throw inside `do { ... } while (false)` must not be erased when the loop exits
(function() {
  "use strict";

  function throwInDoWhile(a) {
    do {
      if (a) throw new Error("boom");
    } while (false);
    return "no-throw";
  }

  function returnInDoWhile(a) {
    do {
      if (a) return "early";
    } while (false);
    return "late";
  }

  if (global.__optimize) {
    __optimize(throwInDoWhile);
    __optimize(returnInDoWhile);
  }
  global.throwInDoWhile = throwInDoWhile;
  global.returnInDoWhile = returnInDoWhile;
})();

inspect = function() {
  var out = [];
  [true, false, 1, 0, "x", ""].forEach(function(a) {
    try {
      out.push(throwInDoWhile(a));
    } catch (e) {
      out.push("throw:" + e.message);
    }
    out.push(returnInDoWhile(a));
  });
  return out.join(",");
};
