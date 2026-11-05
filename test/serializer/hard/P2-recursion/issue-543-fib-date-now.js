// hard: P2
// source: https://github.com/facebookarchive/prepack/issues/543
// goal: do not unroll fib(10) with 177 residual Date.now() calls; output <= 2x input (was 1 line -> 1065 lines)
(function() {
  function fib(x) {
    let y = Date.now(); // the useless line that I added
    return x <= 1 ? x : fib(x - 1) + fib(x - 2);
  }

  let x = Date.now();
  if (x * 2 > 42) x = fib(10);
  global.result = x;
})();

inspect = function() {
  return String(global.result);
};
