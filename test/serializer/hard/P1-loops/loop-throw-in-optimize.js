// hard: P1
// source: new (PP0037: throw in loop body)
// goal: throw from inside a loop with unknown trip count; residual keeps the exception; no FatalError
function validate(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] < 0) throw new Error("negative at " + i);
  }
  return arr.length;
}
if (global.__optimize) __optimize(validate);

inspect = function() {
  var r = [];
  [[1, 2], [3, -1, 4], []].forEach(function(a) {
    try {
      r.push(validate(a));
    } catch (e) {
      r.push(e.message);
    }
  });
  return r.join(",");
};
