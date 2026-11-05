// hard: P6
// source: new (Object.keys on an abstract object + loop, cf. #1959)
// goal: iterate Object.keys of an abstract parameter building a fresh object; correct; no FatalError
function invert(obj) {
  var out = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    out[obj[keys[i]]] = keys[i];
  }
  return out;
}
if (global.__optimize) __optimize(invert);

inspect = function() {
  return JSON.stringify([invert({ a: "x", b: "y" }), invert({})]);
};
