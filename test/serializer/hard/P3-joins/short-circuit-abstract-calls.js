// hard: P3
// source: new
// goal: && / || chains calling abstract functions; calls happen exactly when the original would; correct
function f(a, g, h) {
  var calls = [];
  var r =
    (a &&
      g(function() {
        calls.push("g");
      })) ||
    h(function() {
      calls.push("h");
    });
  return r + ":" + calls.join("");
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var call = function(cb) {
    cb();
    return 1;
  };
  var callFalse = function(cb) {
    cb();
    return 0;
  };
  return [f(true, call, call), f(false, call, call), f(true, callFalse, call)].join(",");
};
