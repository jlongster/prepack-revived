// hard: P4
// source: variant of https://github.com/facebookarchive/prepack/issues/2361 (fuzzer shape)
// goal: chains of conditional values with falsy non-boolean leaves keep exact values, not just truthiness
function main(a1, a2, a3) {
  var a = a1 ? a2 : false;
  var b = a ? a3 : a;
  var c = b || a2;
  return [a, b, c].map(String).join("/");
}
if (global.__optimize) __optimize(main);

inspect = function() {
  return [main(1, 0, 5), main(1, "", "x"), main(0, 7, 8), main(1, 2, null), main(NaN, NaN, NaN)].join(",");
};
