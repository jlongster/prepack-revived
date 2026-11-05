// hard: P6
// source: new
// goal: a local object passed to unknown code may be mutated; later reads must not use stale values
function f(g) {
  var o = { a: 1, nested: { b: 2 } };
  g(o);
  return o.a + o.nested.b;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [
    f(function() {}),
    f(function(o) {
      o.a = 10;
      o.nested.b = 20;
    }),
  ].join(",");
};
