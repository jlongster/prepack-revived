// hard: P3
// source: fuzzer (extended mode)
// goal: method call on a conditional base `(c ? obj : null).m()` must throw TypeError on the null/undefined branch instead of returning null/undefined
(function() {
  "use strict";

  function main(c, d) {
    var obj = {
      m: function() {
        return 42;
      },
    };
    return (c ? obj : d ? null : undefined).m();
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [[true, true], [false, true], [false, false]]
    .map(function(args) {
      try {
        return String(main(args[0], args[1]));
      } catch (e) {
        return "throw:" + e.name;
      }
    })
    .join(",");
};
