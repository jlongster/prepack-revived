// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/2120
// goal: emit try/catch around a possibly-throwing abstract call instead of a RecoverableError (PP0021)
function f(g) {
  try {
    return g();
  } catch (e) {
    return 42;
  }
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [
    f(function() {
      return 1;
    }),
    f(function() {
      throw new Error("x");
    }),
  ].join(",");
};
