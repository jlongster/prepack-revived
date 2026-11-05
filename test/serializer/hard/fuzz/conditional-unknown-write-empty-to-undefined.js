// hard: P8
// source: fuzzer (extended mode, seed 988166042)
// goal: a property read whose value is conditionally empty (written via an unknown key) must still be promoted to undefined when stored
(function() {
  "use strict";

  function main(a1, a2) {
    var o2 = {};
    if (a2) {
      o2[a2] = undefined;
    }
    o2.p1 = o2.length;
    return [o2];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return JSON.stringify([main(false, false), main(false, "length"), main(0, "q")].map(function(r) {
    return [Object.keys(r[0]), "p1" in r[0], String(r[0].p1)];
  }));
};
