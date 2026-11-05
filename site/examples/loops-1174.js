function sum(n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    s += i;
  }
  return s;
}
if (global.__optimize) __optimize(sum);
