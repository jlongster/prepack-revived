// hard: P5
// source: https://github.com/facebookarchive/prepack/issues/1066
// goal: push after a conditional push (length in [0,1]) works without FatalError
var a = [];
var x = global.__abstract ? __abstract("boolean", "(true)") : true;
(function() {
  if (x) a.push(42);
  a.push(23);
})();

inspect = function() {
  return a.join(",") + "|" + a.length;
};
