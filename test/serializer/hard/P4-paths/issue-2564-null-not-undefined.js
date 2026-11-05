// hard: P4
// source: https://github.com/facebookarchive/prepack/issues/2564
// goal: y == null must not imply y === undefined inside an optimized function
function f(obj) {
  let y = obj.foo;
  if (y == null) {
    obj.bar = y === undefined;
  }
  return obj;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f({ foo: null }).bar, f({}).bar, f({ foo: 1 }).bar].map(String).join(",");
};
