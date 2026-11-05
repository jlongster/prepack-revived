// hard: P6
// source: fuzzer (extended mode, seeds 198691015 and 535795820)
// goal: `in` and `hasOwnProperty` on leaked objects must not fold to true via synthetic descriptors, and leaking an object with computed properties must preserve property insertion order
(function() {
  "use strict";

  function main(fn, k) {
    var o = { p1: 1 };
    o[k] = 2;
    fn(o);
    return [0 in o, Object.prototype.hasOwnProperty.call(o, "missing"), Object.keys(o).join("|")];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  var noop = function() {};
  var addZero = function(o) {
    o[0] = 9;
  };
  return JSON.stringify([main(noop, "x"), main(addZero, "y")]);
};
