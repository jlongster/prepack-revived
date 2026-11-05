// throws introspection error
var calls = 0;
function rec(k) {
  calls++;
  return k <= 0 ? 0 : rec(k - 1);
}
function f(n) {
  rec(n);
  return calls;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(2), f(3)].join(",");
};
