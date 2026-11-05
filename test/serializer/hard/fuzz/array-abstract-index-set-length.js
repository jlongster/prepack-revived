// hard: P6
// source: fuzzer (extended mode, seed 198685414)
// goal: writing an abstract property key to an ArrayValue (`arr[k] = v`) must not keep stale concrete `arr.length` when `k` can be an index >= old length
(function() {
  "use strict";

  function main(k) {
    var arr = [0];
    arr[k] = arr.length;
    return arr.length;
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [main(0), main(1), main(4), main("foo")].join(",");
};
