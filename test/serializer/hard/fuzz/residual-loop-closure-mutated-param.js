// hard: P1
// source: fuzzer (extended mode, seed 198684591)
// goal: residualized loop must not pass a local binding as a read-only parameter when a closure called inside the loop mutates that binding
(function() {
  "use strict";

  function main(cond, a2) {
    var bump = function() {
      a2++;
    };
    var i = 0;
    do {
      bump();
      (a2 || "").charAt(0);
    } while (cond && ++i < 3);
    return a2;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [[true, false], [false, "abc"]]
    .map(function(c) {
      try {
        return String(main(c[0], c[1]));
      } catch (e) {
        return "throw:" + e.name;
      }
    })
    .join(",");
};
