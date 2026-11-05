// hard: P3
// source: variant of https://github.com/facebookarchive/prepack/issues/2363
// goal: same shape as #2363 but returning distinct values so a wrong join is observable
function main(a1, a2, a3, a4) {
  var x = a1 ? (a2 ? a2 : false) : false;
  if (!x) {
    if (a3 ? x : a3) {
      return "A";
    } else {
      if (!a4) return "B";
    }
    return "C";
  }
  return "D:" + x;
}
if (global.__optimize) __optimize(main);

inspect = function() {
  var r = [];
  for (var i = 0; i < 16; i++) r.push(main(i & 1, i & 2, i & 4, i & 8));
  return r.join(",");
};
