// hard: P6
// source: new (callbacks of builtins over abstract arrays, cf. #2336)
// goal: filter/map callbacks over an abstract array that mutate local state; correct counts; no FatalError
function f(arr) {
  var stats = { seen: 0 };
  var big = arr.filter(function(x) {
    stats.seen++;
    return x > 1;
  });
  return big.length + ":" + stats.seen;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f([1, 2, 3]), f([])].join(",");
};
