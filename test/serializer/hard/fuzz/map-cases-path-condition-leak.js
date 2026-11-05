// hard: P5
// source: fuzzer (extended mode, seeds 198689979 and 198682449)
// goal: mapCases and aborted speculative loop unrolling must restore realm.pathConditions instead of leaking branch assumptions into subsequent code
(function() {
  "use strict";

  function boundedLoop(a1, a2) {
    for (var i = 0; i < +(a2 === 0); i++) {
      if (a1) continue;
      throw new Error("stop");
    }
    return i;
  }

  function abortedDoWhile(p) {
    do {
      if (p) break;
    } while (typeof p);
    if (p) p = "taken";
    return p;
  }

  function main(a1, a2, p) {
    return [boundedLoop(a1, a2), abortedDoWhile(p)];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return JSON.stringify([main(10, undefined, [1, 2]), main(10, 0, "x")]);
};
