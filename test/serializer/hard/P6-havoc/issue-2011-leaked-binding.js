// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2011
// goal: after a binding leaks, only the last write before return is emitted and its value is known
function f(g) {
  let x = 23;
  function h() {
    return x;
  }
  g(h); // <- this leaks x
  x = 1;
  x = 2;
  x = 3;
  x = 4;
  x = 5;
  return x;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var saved;
  var r = f(function(fn) {
    saved = fn;
    return fn();
  });
  return r + ":" + saved();
};
