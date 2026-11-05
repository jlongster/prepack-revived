// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2319 (RegExp.prototype.test, #1 bail-out)
// goal: RegExp.prototype.test on an abstract string is pure; no leaking of local objects; no FatalError
function f(s) {
  var re = /^a+b?$/;
  var state = { matched: 0 };
  if (re.test(s)) state.matched = 1;
  return state.matched + ":" + re.lastIndex;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return ["aab", "b", "a"].map(f).join(",");
};
