// does not contain:n - 5
function fib(n) {
  return n <= 1 ? n : fib(n - 1) + fib(n - 2);
}
function f(n) {
  return "fib=" + fib(n);
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(0), f(1), f(7), f(12)].join(",");
};
