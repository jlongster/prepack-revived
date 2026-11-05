// hard: P8
// source: fuzzer (extended mode, seed 988165409)
// goal: leaked bindings of a helper called twice must stay declared after the serializer's second pass
(function() {
  "use strict";

  function h1(p1, p2, p3) {
    try {
      p3 = -p3;
    } catch (e3) {}
    if (0) {
      p3++;
    } else {
      for (var i4 = p1; i4; i4--) {}
    }
  }

  function main(a1, a2) {
    var r7 = [h1(a1, 0, a1)];
    try {
    } finally {
      h1(0, 0, a1);
    }
    return r7;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return JSON.stringify([main(undefined), main(3), main(0)]);
};
