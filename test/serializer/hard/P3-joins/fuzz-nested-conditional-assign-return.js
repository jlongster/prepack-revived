// hard: P3
// source: new (fuzzer shape from #2354/#2363 with non-boolean inputs)
// goal: conditional assignments followed by returns under abstract conditions; exact values on all 27 inputs
function main(a1, a2, a3) {
  var x = 0;
  if (a1) x = a2;
  else if (a2) return a3;
  if (x) {
    if (a3) return x;
    x = a1;
  }
  return x || a3;
}
if (global.__optimize) __optimize(main);

inspect = function() {
  var vals = [0, "", "s", 2, null, true];
  var out = [];
  vals.forEach(function(a) {
    vals.forEach(function(b) {
      vals.forEach(function(c) {
        out.push(String(main(a, b, c)));
      });
    });
  });
  return out.join(",");
};
