// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2319 (Array.prototype.indexOf)
// goal: indexOf on an abstract array with an abstract needle does not havoc the needle or locals
function f(arr, x) {
  var meta = { hits: 0 };
  var key = { id: x };
  var i = arr.indexOf(key.id);
  if (i >= 0) meta.hits++;
  return i + ":" + meta.hits + ":" + key.id;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(["a", "b"], "b"), f([], "z"), f([1, 2, 3], 3)].join(",");
};
