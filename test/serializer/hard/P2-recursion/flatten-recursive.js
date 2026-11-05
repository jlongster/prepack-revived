// hard: P2
// source: new
// goal: recursive flatten of an abstract nested array; residual recursion + loop; correct
function flatten(arr, out) {
  for (var i = 0; i < arr.length; i++) {
    if (Array.isArray(arr[i])) flatten(arr[i], out);
    else out.push(arr[i]);
  }
  return out;
}
function flat(arr) {
  return flatten(arr, []).join(",");
}
if (global.__optimize) __optimize(flat);

inspect = function() {
  return [flat([1, [2, [3, [4]]], 5]), flat([])].join("|");
};
