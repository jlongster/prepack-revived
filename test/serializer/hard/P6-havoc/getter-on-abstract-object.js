// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/1682 (simple objects and side effects)
// goal: reading the same property twice from an abstract object with a getter must not be CSE'd
function f(o) {
  var a = o.v;
  var b = o.v;
  return a + "," + b;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var n = 0;
  var o = {
    get v() {
      return ++n;
    },
  };
  return f(o) + "|" + f({ v: 7 });
};
