// hard: P3
// source: fuzzer (extended mode, seed 1105; Prepack reports PP0001 but still emits code, which is wrong)
// goal: no PP0001, and a value joined from a branch whose call may throw (`a ? Math.min(h(a), a) : 0`) must keep the 0 of the other branch, so h(0) still throws
(function() {
  "use strict";

  function h(p) {
    if (p >= 0) throw new Error("h" + p);
  }

  function main(a1) {
    var x = a1 ? Math.min(h(a1), a1) : 0;
    h(x);
    return x;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [undefined, 0, -1, 1, "x", null]
    .map(function(a) {
      try {
        return String(main(a));
      } catch (e) {
        return "throw " + e.message;
      }
    })
    .join(",");
};
