// hard: P8
// source: fuzzer (extended mode, seed 538289308)
// goal: pure-call inlining/recursion probe must handle concrete null and undefined arguments without violating AbstractValue type invariants
(function() {
  "use strict";

  function helper(p1, p2) {
    var r = "0" <= p2 ? Math.max(p2, p1) : p2 - p1 ? typeof p1 === "number" : !p1 ? 3 + p1 : String(p1) + "string";
    return r ? String(r).slice(0, 4) : undefined;
  }

  function main(a1, a2) {
    var u = helper(false, 0);
    var x = helper(a1, u);
    var y = helper(a2, null);
    var z = helper(a1, a2);
    return [x, y, z];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return JSON.stringify([main(1, 2), main("a", undefined)]);
};
