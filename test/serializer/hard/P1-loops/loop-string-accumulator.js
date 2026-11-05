// hard: P1
// source: new
// goal: string accumulator in a loop with unknown bound; residual loop; correct string
function csv(n, sep) {
  var out = "";
  for (var i = 0; i < n; i++) {
    out += (i > 0 ? sep : "") + "c" + i;
  }
  return out;
}
if (global.__optimize) __optimize(csv);

inspect = function() {
  return [csv(3, ","), csv(0, ";"), csv(1, "-")].join("|");
};
