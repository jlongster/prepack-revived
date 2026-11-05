// hard: P1
// source: new
// goal: break under an abstract condition inside a residual loop; no FatalError
function find(arr, x) {
  var i;
  for (i = 0; i < arr.length; i++) {
    if (arr[i] === x) break;
  }
  return i;
}
if (global.__optimize) __optimize(find);

inspect = function() {
  return [find([1, 2, 3], 2), find([1, 2, 3], 9), find([], 1)].join(",");
};
