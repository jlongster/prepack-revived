// hard: P8
// source: https://github.com/facebookarchive/prepack/issues/2011
// goal: emit only the last write to a leaked binding before return; output <= 1.5x input
// max size ratio: 1.5
function f(g) {
  let x = 23;
  function h() {
    return x;
  }
  g(h);
  x = 1;
  x = 2;
  x = 3;
  x = 4;
  x = 5;
  return x;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return String(
    f(function(fn) {
      return fn();
    })
  );
};
