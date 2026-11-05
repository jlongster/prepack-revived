// hard: P1
// source: fuzzer (extended mode, seed 1190)
// goal: no invariant in serializer/Emitter.js finalize for an object created in a do/while whose body may throw and whose condition is abstract
(function() {
  "use strict";

  function main(a) {
    do {
      var o = { p0: a.slice(0) };
      a = a.length > 1 ? a.slice(1) : "";
    } while (a);
    return o.p0;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return ["", "abc", [1, 2, 3], 5]
    .map(function(a) {
      try {
        return String(main(a));
      } catch (e) {
        return "throw " + e.name;
      }
    })
    .join(",");
};
