// hard: P4
// source: fuzzer (extended mode, seed 213607)
// goal: `!a && a != null` is feasible (0, "", false, NaN); Path.implies and Path.impliesNot must not both return true in ResidualHeapVisitor
(function() {
  "use strict";

  function main(a, f) {
    var o = {};
    if (!a) {
      o.p = 0;
      if (a == null) throw new Error("nullish");
      f(o);
    }
    return o.p;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var inputs = [0, "", false, NaN, 1, "x", null, undefined];
  return inputs
    .map(function(a) {
      try {
        return String(
          main(a, function(o) {
            o.p = o.p + 1;
          })
        );
      } catch (e) {
        return "throw:" + e.message;
      }
    })
    .join(",");
};
