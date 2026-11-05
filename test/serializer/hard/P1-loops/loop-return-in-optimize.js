// hard: P1
// source: new (PP0037: return in loop body)
// goal: return from inside a loop with unknown trip count; no FatalError
function indexOfChar(s, ch) {
  for (var i = 0; i < s.length; i++) {
    if (s.charAt(i) === ch) return i;
  }
  return -1;
}
if (global.__optimize) __optimize(indexOfChar);

inspect = function() {
  return [indexOfChar("hello", "l"), indexOfChar("hello", "z"), indexOfChar("", "a")].join(",");
};
