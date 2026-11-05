// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2179
// goal: an object returned by unknown code may alias an argument; writing it must invalidate obj1.x
function f(g) {
  var obj1 = { x: 1 };
  var obj2 = g(obj1);
  obj2.x = 2;
  return obj1.x;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [
    f(function(o) {
      return o;
    }),
    f(function() {
      return {};
    }),
  ].join(",");
};
