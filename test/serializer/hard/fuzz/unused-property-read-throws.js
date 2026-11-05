// hard: P6
// source: fuzzer (extended mode, seeds 218947 and 223568)
// goal: an unused property read `a.p` on an unknown argument in __optimize must not be dead-code-eliminated when `a` may be null/undefined or have a throwing/side-effecting getter
(function() {
  "use strict";

  function main(a) {
    var unused = a.p;
    return 1;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var getterRan = 0;
  var withGetter = {};
  Object.defineProperty(withGetter, "p", {
    get: function() {
      getterRan++;
      return 42;
    },
  });
  var throwingGetter = {};
  Object.defineProperty(throwingGetter, "p", {
    get: function() {
      throw new Error("getter");
    },
  });
  var cases = [null, undefined, { p: 3 }, "str", 0, withGetter, throwingGetter];
  return (
    cases
      .map(function(c) {
        try {
          return String(main(c));
        } catch (e) {
          return "throw:" + (e.name === "Error" ? e.message : e.name);
        }
      })
      .join(",") +
    "|getterRan=" +
    getterRan
  );
};
