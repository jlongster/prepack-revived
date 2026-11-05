// hard: P3
// source: fuzzer (extended mode, seed 500340)
// goal: a conditional `break label` out of a labeled block must resume at the statement after the block, not skip residual calls after it and return undefined
(function() {
  "use strict";

  function main(a, fn) {
    B: {
      if (a) break B;
    }
    return fn(a);
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  function tag(x) {
    return "called:" + x;
  }
  return [main(true, tag), main(false, tag), main(1, tag), main(0, tag)].map(String).join(",");
};
