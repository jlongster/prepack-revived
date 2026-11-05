// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/2120
// goal: property access on a leaked object may throw (setter/getter); must keep the catch handler (silently erased today)
function f(g) {
  var o = {};
  g(o);
  try {
    o.foo = 42;
    return o.bar;
  } catch (e) {
    return 42;
  }
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [
    f(function(o) {
      o.bar = 7;
    }),
    f(function(o) {
      Object.defineProperty(o, "foo", {
        set: function() {
          throw new Error("no");
        },
      });
    }),
    f(function(o) {
      Object.defineProperty(o, "bar", {
        get: function() {
          throw new Error("no");
        },
      });
    }),
  ].join(",");
};
