// hard: P3
// source: fuzzer (extended mode, seeds 500699, 501072, 501448 and 503556)
// goal: conditional return or throw in the body or test of a terminating do/while must not be dropped by evaluateWithUndoForDiagnostic
(function() {
  "use strict";

  function boom() {
    throw new Error("boom");
  }

  function throwInBody(a) {
    do {
      if (a) throw new Error("body");
    } while (false);
    return "no-throw";
  }

  function returnInBody(a) {
    do {
      if (a) return "early";
    } while (false);
    return "late";
  }

  function throwInTest(a) {
    do {} while (a && boom());
    return "test-ok";
  }

  if (global.__optimize) {
    __optimize(throwInBody);
    __optimize(returnInBody);
    __optimize(throwInTest);
  }
  global.throwInBody = throwInBody;
  global.returnInBody = returnInBody;
  global.throwInTest = throwInTest;
})();

inspect = function() {
  var out = [];
  [true, false, 1, 0].forEach(function(a) {
    [throwInBody, returnInBody, throwInTest].forEach(function(fn) {
      try {
        out.push(fn(a));
      } catch (e) {
        out.push("throw:" + e.message);
      }
    });
  });
  return out.join(",");
};
