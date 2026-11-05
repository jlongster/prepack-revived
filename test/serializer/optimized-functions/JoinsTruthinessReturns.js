// Joining "return true" and "return false" under a non-boolean condition must yield a boolean (#2354, #2355).
function f(a) {
  if (a) return true;
  return false;
}

function g(a) {
  if (!a) return false;
  return true;
}

function h(a1, a2, a3) {
  if (a1) {
    if (a2) {
      return false;
    }
  }
  if (!a3) {
    return false;
  }
  return true;
}

if (global.__optimize) {
  __optimize(f);
  __optimize(g);
  __optimize(h);
}

inspect = function() {
  var vals = [0, 1, "", "x", NaN, null, undefined, {}];
  return [vals.map(f).join(), vals.map(g).join(), h(0, "", NaN), h(1, 0, "x"), h(1, 1, 1), h("", "", "s")].join("|");
};
