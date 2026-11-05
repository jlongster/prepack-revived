// hard: P4
// source: fuzzer (extended mode, seed 1203)
// goal: `!(a == null ? 0 : a)` must not be simplified to `a == null` (wrong for 0, "", false, NaN)
(function() {
  "use strict";

  function main(a) {
    return !(a == null ? 0 : a);
  }

  function viaArray(a) {
    var r = [a == null ? 0 : a];
    return !r[0];
  }

  if (global.__optimize) {
    __optimize(main);
    __optimize(viaArray);
  }
  global.main = main;
  global.viaArray = viaArray;
})();

inspect = function() {
  var inputs = [0, 1, null, undefined, "", "x", false, NaN];
  return inputs.map(main).join(",") + "|" + inputs.map(viaArray).join(",");
};
