// hard: P8
// source: https://github.com/facebookarchive/prepack/issues/2286
// goal: no duplicate `x + 1` computation; output <= 1.5x input
// max size ratio: 1.5
var o = {};
function f(x) {
  o.x = x + 1;
  return [o, x + 1];
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var r = f(1);
  return r[0].x + "," + r[1] + "," + (r[0] === o);
};
