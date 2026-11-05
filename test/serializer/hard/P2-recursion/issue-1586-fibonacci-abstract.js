// hard: P2
// source: https://github.com/facebookarchive/prepack/issues/1586 (test/serializer/abstract/Fibonacci.js, disabled)
// goal: recursion on an abstract argument is summarized (residual recursive function), not unrolled or fatal
let n = global.__abstract ? global.__abstract("number", "4") : 4;

function fibonacci(x) {
  return x <= 1 ? x : fibonacci(x - 1) + fibonacci(x - 2);
}

let x = fibonacci(n);
let y = typeof x;

inspect = function() {
  return x + " " + y;
};
