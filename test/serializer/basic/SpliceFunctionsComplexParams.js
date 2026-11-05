// Deliberately mixes sloppy top-level helper and strict factory closures with default/rest/destructuring params.
function sloppyHelper(x) {
  return x + 1;
}

(function() {
  "use strict";

  function makeScale(domainStart, factor) {
    return function scale(value = 0) {
      const shifted = value - domainStart;
      const scaled = shifted * factor;
      return Math.round(scaled * 100) / 100;
    };
  }

  function makeSlice(prefix, multiplier) {
    return function slice(a, b, lo = 0, ...rest) {
      let total = (a + b + lo) * multiplier;
      for (let i = 0; i < rest.length; i++) total += rest[i];
      return prefix + ":" + total + ":" + rest.length;
    };
  }

  function makeConfig(baseTag) {
    return function configure({ host = "localhost", port = 80 } = {}, [retry = 1] = []) {
      const endpoint = baseTag + "://" + host + ":" + port;
      return endpoint + "#" + retry;
    };
  }

  global.sloppyHelper = sloppyHelper;
  global.s1 = makeScale(10, 2.5);
  global.s2 = makeScale(0, 0.5);
  global.sl1 = makeSlice("A", 2);
  global.sl2 = makeSlice("B", 3);
  global.c1 = makeConfig("http");
  global.c2 = makeConfig("https");
})();

inspect = function() {
  return [
    global.sloppyHelper(4),
    global.s1.length,
    global.s1(),
    global.s1(14),
    global.s2(),
    global.s2(9),
    global.sl1.length,
    global.sl1(1, 2),
    global.sl1(1, 2, 3, 4, 5),
    global.sl2(2, 3, undefined, 10),
    global.c1.length,
    global.c1(),
    global.c1({ port: 8080 }, [3]),
    global.c2({ host: "api" }),
  ].join(",");
};
