// hard: P1
// source: new
// goal: loop whose fixpoint involves two mutually dependent bindings; residual loop; correct gcd
function gcd(a, b) {
  while (b !== 0) {
    var t = b;
    b = a % b;
    a = t;
  }
  return a;
}
if (global.__optimize) __optimize(gcd);

inspect = function() {
  return [gcd(12, 18), gcd(17, 5), gcd(0, 9), gcd(9, 0)].join(",");
};
