// hard: P3
// source: variant of https://github.com/facebookarchive/prepack/issues/2354 (fuzzer shape)
// goal: returns under abstract conditions with mutations of a captured counter; correct effects on every path
var counter = { n: 0 };
function main(a1, a2, a3) {
  counter.n++;
  if (a1) {
    counter.n += 10;
    if (a2) return 1;
    counter.n += 100;
  } else if (a3) {
    return 2;
  }
  if (a2 && a3) return 3;
  counter.n += 1000;
  return 4;
}
if (global.__optimize) __optimize(main);

inspect = function() {
  var r = [];
  for (var i = 0; i < 8; i++) {
    counter.n = 0;
    r.push(main(i & 1, i & 2, i & 4) + ":" + counter.n);
  }
  return r.join(",");
};
