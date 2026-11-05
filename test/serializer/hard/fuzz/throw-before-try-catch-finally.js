// hard: P3
// source: fuzzer (extended mode, seeds 203148 and 209106)
// goal: an exception thrown under an abstract condition BEFORE a try statement must not be caught by catch or run finally
(function() {
  "use strict";

  function withCatch(a) {
    if (a) throw new Error("before");
    try {
    } catch (e) {
      return "caught:" + e.message;
    }
    return "ok";
  }

  function withFinally(a, log) {
    if (a) throw new Error("before");
    try {
    } finally {
      log.push("finally");
    }
    return "ok";
  }

  function withFinallyReturn(a) {
    if (a) throw new Error("before");
    try {
    } finally {
      return "swallowed";
    }
  }

  if (global.__optimize) {
    __optimize(withCatch);
    __optimize(withFinally);
    __optimize(withFinallyReturn);
  }
  global.withCatch = withCatch;
  global.withFinally = withFinally;
  global.withFinallyReturn = withFinallyReturn;
})();

inspect = function() {
  var log = [];
  function run(fn) {
    try {
      return fn();
    } catch (e) {
      return "throw:" + e.message;
    }
  }
  return [
    run(function() {
      return withCatch(true);
    }),
    run(function() {
      return withCatch(false);
    }),
    run(function() {
      return withFinally(true, log);
    }),
    run(function() {
      return withFinally(false, log);
    }),
    log.join("+"),
    run(function() {
      return withFinallyReturn(true);
    }),
    run(function() {
      return withFinallyReturn(false);
    }),
  ].join(",");
};
