// hard: P6
// source: new
// goal: a closure handed to unknown code can write a captured binding; later reads see the update
function f(g) {
  var x = 1;
  g(function() {
    x = 2;
  });
  return x;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [
    f(function(cb) {
      cb();
    }),
    f(function() {}),
  ].join(",");
};
