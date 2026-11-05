// hard: P1
// source: new
// goal: for-in over an abstract object; residual for-in loop; no FatalError
function serialize(obj) {
  var parts = [];
  for (var k in obj) {
    parts.push(k + "=" + obj[k]);
  }
  return parts.join("&");
}
if (global.__optimize) __optimize(serialize);

inspect = function() {
  return [serialize({ a: 1, b: "two" }), serialize({}), serialize({ z: null })].join("|");
};
