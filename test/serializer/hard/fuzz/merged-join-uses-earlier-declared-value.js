// hard: P8
// source: fuzzer (extended mode, seed 988165887)
// goal: adjacent joins on the same condition must not be merged when the later one uses a value declared inside the earlier one
(function() {
  function main(a1, a2) {
    var r4 = [a1 ? a2(0, 0) : 0];
    if (a1) {
    } else {
      try {
      } finally {
        if (r4.join(0)) {
        }
      }
    }
    return [r4];
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return JSON.stringify([
    main(1, function() {
      return true;
    }),
    main(0),
  ]);
};
