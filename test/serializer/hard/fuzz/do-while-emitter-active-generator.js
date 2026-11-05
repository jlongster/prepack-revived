// hard: P1
// source: fuzzer (extended mode, seed 203556)
// goal: no invariant in serializer/Emitter.js _emitAfterWaitingForGeneratorBody when an unreturned object written in a do/while has a throwing property write after the loop
(function() {
  "use strict";

  function main(a1, a3) {
    var o = {};
    var i = 0;
    do {
      o[0] = a3;
    } while (a1 * 0 && ++i < 2);
    o.p2 = a3.charAt(0);
    return i;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return ["abc", "", 5]
    .map(function(s) {
      try {
        return String(main(1, s));
      } catch (e) {
        return "throw:" + e.name;
      }
    })
    .join(",");
};
