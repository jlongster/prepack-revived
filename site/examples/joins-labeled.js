function f(a, b) {
  var r = "start";
  block: {
    if (a) break block;
    r += "-1";
    if (b) break block;
    r += "-2";
  }
  return r;
}
if (global.__optimize) __optimize(f);
