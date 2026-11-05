// hard: P4
// source: fuzzer (classic mode, seed 100211)
// goal: no unhandled InfeasiblePathError ("Infeasible path explored") from Realm.evaluateWithAbstractConditional on repeated checks of an abstract parameter
(function() {
  "use strict";

  function empty() {}
  function id(x) {
    return x;
  }

  function main(a1, a2, a9, a10, a15, a17) {
    var x1, x16, x9, x10, x17, x20, x19, x27;
    x1 = a1;
    x16 = x1;
    if (x16) {
      if (a2) {
      } else {
        return x1;
      }
    } else {
      x9 = a9;
      if (x9 ? (x1 ? a10 : a9) : empty()) {
        if (a9) {
          return x10;
        }
      }
    }
    x17 = x16;
    if (1) {
      if (id(x17)) {
        return empty();
      } else {
        if (a15) {
        } else {
          x19 = a17;
        }
        x20 = x19;
      }
      x20;
    }
    x27 = x16;
    if (x27) {
    }
    return x20;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [
    main(true, false, false, 1, false, "a"),
    main(true, true, false, 1, false, "b"),
    main(false, false, true, 1, false, "c"),
    main(false, false, false, 1, false, "d"),
    main(false, false, false, 1, true, "e"),
  ]
    .map(String)
    .join(",");
};
