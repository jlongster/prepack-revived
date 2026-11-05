// hard: P4
// source: new
// goal: the same abstract condition tested twice in sequence is resolved on the second test (no 4-way blowup)
function f(c, v) {
  var parts = [];
  if (c) parts.push("x");
  else parts.push("no-x");
  if (c) parts.push("y");
  else parts.push("no-y");
  return parts.join("-") + v;
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(true, 1), f(false, 2), f(0, 3)].join(",");
};
