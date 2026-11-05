// hard: P4
// source: variant of https://github.com/facebookarchive/prepack/issues/2355
// goal: ternaries and logical ops over non-boolean abstract values keep JS truthiness semantics
function main(a, b) {
  var x = a ? true : false;
  var y = a || false;
  var z = a && b ? b : a;
  var w = !a ? false : true;
  return [x, y, z, w].map(String).join("/");
}
if (global.__optimize) __optimize(main);

inspect = function() {
  return [main(0, 1), main(2, 0), main("", "s"), main("q", "r"), main(null, 3)].join(",");
};
