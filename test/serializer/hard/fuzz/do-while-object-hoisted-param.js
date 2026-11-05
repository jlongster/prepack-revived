// hard: P1
// source: fuzzer (extended mode, seeds 207060, 224873 and 232647)
// goal: an object literal `{ p0: a }` inside a widened do/while must not be emitted at module scope referencing parameter `a` (ReferenceError on load)
(function() {
  "use strict";

  function main(a, step) {
    do {
      var keepGoing = step();
      var o = { p0: a };
    } while (keepGoing);
    return o.p0;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var n = 0;
  return String(
    main(42, function() {
      return ++n < 3;
    })
  );
};
