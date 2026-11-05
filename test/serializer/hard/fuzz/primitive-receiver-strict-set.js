// hard: P6
// source: fuzzer (extended mode, seed 779288986)
// goal: computed property write on a primitive receiver (`0[k] = v`) runs ToPropertyKey(k) and throws TypeError in strict mode while ignoring the write in sloppy mode
(function() {
  function sloppySet(k) {
    0[k] = 1;
    return "ok";
  }

  function strictSet(k) {
    "use strict";
    0[k] = 1;
    return "ok";
  }

  function main(strict, k) {
    return strict ? strictSet(k) : sloppySet(k);
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var log = 0;
  var keyObj = {
    toString: function() {
      log++;
      return "p";
    },
  };
  var badKey = {
    toString: function() {
      throw new RangeError("bad");
    },
  };
  var sym = Symbol("k");
  var cases = [[true, "a"], [true, keyObj], [true, sym], [true, badKey], [false, keyObj], [false, sym], [false, badKey]];
  return (
    cases
      .map(function(c) {
        try {
          return main(c[0], c[1]);
        } catch (e) {
          return "throw:" + e.name;
        }
      })
      .join(",") +
    "|log=" +
    log
  );
};
