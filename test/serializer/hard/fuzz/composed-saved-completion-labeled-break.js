// hard: P3
// source: fuzzer (extended mode, seed 779288836)
// goal: nested savedCompletion chain inside a labeled block must not duplicate or drop an outer labeled break when a nested switch throws
(function() {
  "use strict";

  function main(a2, a3, a4) {
    switch (a4) {
      case null:
        B4: {
          if (a2) break B4;
          if (0 <= a3) {
            if (!a3) throw new RangeError("z");
          } else {
            return 0;
          }
          switch (0) {
            default:
              if (undefined[0]) break;
          }
        }
    }
    return "done";
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var cases = [["s", -0, null], ["", -1, null], ["", 0, null], ["", 2, null], ["", 0, 1]];
  return cases
    .map(function(c) {
      try {
        return String(main(c[0], c[1], c[2]));
      } catch (e) {
        return "throw:" + e.name;
      }
    })
    .join(",");
};
