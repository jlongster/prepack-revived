// A conditional break inside a switch on a known value must exit the switch.
function f(a) {
  var r = "s";
  switch (1) {
    case 1:
      if (a) break;
      r += "x";
    case 2:
      r += "y";
  }
  return r;
}

function g(a, v) {
  var r = "s";
  switch (v) {
    case 1:
      if (a) break;
      r += "1";
    case 2:
      if (!a) return "ret" + r;
      r += "2";
      break;
    default:
      r += "d";
  }
  return r + "e";
}

if (global.__optimize) {
  __optimize(f);
  __optimize(g);
}

inspect = function() {
  return [f(true), f(false), g(true, 1), g(false, 1), g(true, 2), g(false, 2), g(false, 3)].join();
};
