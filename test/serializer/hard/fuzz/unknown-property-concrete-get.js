// hard: P6
// source: fuzzer (extended mode, seed 207807)
// goal: no invariant in methods/get.js OrdinaryGet when a dynamic write `o[k] = undefined` stores a concrete value on unknownProperty and a static property is read
(function() {
  "use strict";

  function main(k) {
    var o = { a: 1 };
    o[k] = undefined;
    return [o.a, o.x];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main("a"), main("x"), main("z")]
    .map(function(r) {
      return r.map(String).join(":");
    })
    .join(",");
};
