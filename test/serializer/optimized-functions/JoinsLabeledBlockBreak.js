// A break out of a labeled block under an abstract condition must not be ignored.
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

function g(a) {
  var r = "s";
  out: {
    if (a) break out;
    r += "x";
    inner: {
      r += "i";
    }
    for (var i = 0; i < 2; i++) r += i;
    r += "y";
  }
  return r;
}

if (global.__optimize) {
  __optimize(f);
  __optimize(g);
}

inspect = function() {
  return [f(true, true), f(false, true), f(false, false), g(true), g(false)].join(",");
};
