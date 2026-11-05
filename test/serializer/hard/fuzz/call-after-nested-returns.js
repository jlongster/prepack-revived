// hard: P3
// source: fuzzer (classic mode, seeds 101937 and 102543)
// goal: calling a helper on the remaining normal path after nested returns must not drop an earlier return arm
(function() {
  "use strict";

  function noop() {}

  function main(a, b, c) {
    if (a) {
      if (b) {
        if (c) {
          return 0;
        }
      } else {
        return undefined;
      }
    } else {
      return 0;
    }
    noop();
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var r = [];
  [false, true].forEach(function(a) {
    [false, true].forEach(function(b) {
      [false, true].forEach(function(c) {
        r.push(String(main(a, b, c)));
      });
    });
  });
  return r.join(",");
};
