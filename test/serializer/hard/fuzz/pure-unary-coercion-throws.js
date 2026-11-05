// hard: P6
// source: fuzzer (extended mode, seed 10383)
// goal: unary numeric coercions (+x, -x, ~x) on unknown values in __optimize residualize cleanly without PP0008 and preserve side effects/throws
(function() {
  "use strict";

  function main(a, b) {
    var v = a.p;
    -v;
    return +b;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var side = 0;
  var sym = Symbol("s");
  var obj = {
    p: {
      valueOf: function() {
        side++;
        return 3;
      },
    },
  };
  var cases = [[null, 1], [obj, "4"], [{ p: sym }, 1], [{ p: 1 }, sym]];
  return (
    cases
      .map(function(c) {
        try {
          return String(main(c[0], c[1]));
        } catch (e) {
          return "throw:" + e.name;
        }
      })
      .join(",") +
    "|side=" +
    side
  );
};
