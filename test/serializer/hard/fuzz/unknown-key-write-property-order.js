// hard: P8
// source: fuzzer (extended mode, seed 988166042)
// goal: properties created after a write with an unknown key must enumerate after it
(function() {
  function main(k1, k2, c) {
    var o = { a: 1 };
    o[k1] = 2;
    o.b = 3;
    o[k2] = 4;
    o.c = 5;
    if (c) {
      o.d = 6;
    }
    return o;
  }

  function leaked(k1, k2) {
    var o = {};
    o[k1] = undefined;
    o.p1 = 0;
    o[k2] = 1;
    o.p2 = 2;
    return Object.keys(o).join() + JSON.stringify(o);
  }

  if (global.__optimize) {
    __optimize(main);
    __optimize(leaked);
  }
  global.main = main;
  global.leaked = leaked;
})();

inspect = function() {
  var results = [main("x", "y", true), main("b", "a", false), main("c", "c", true), main("1", "d", true)].map(
    function(o) {
      return Object.keys(o).join() + JSON.stringify(o);
    }
  );
  return results.concat([leaked(false, "z"), leaked("p1", "p2"), leaked("7", "q")]).join("\n");
};
