// does not contain:n - 5
function fib(n) {
  return n <= 1 ? n : fib(n - 1) + fib(n - 2);
}
if (global.__optimize) __optimize(fib);

inspect = function() {
  return [fib(0), fib(1), fib(7), fib(10)].join(",");
};
