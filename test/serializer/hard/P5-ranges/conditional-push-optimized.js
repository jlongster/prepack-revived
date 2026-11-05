// hard: P5
// source: variant of https://github.com/facebookarchive/prepack/issues/1066
// goal: conditional pushes in an optimized function; length stays usable; no FatalError
function classes(active, disabled, big) {
  var a = ["btn"];
  if (active) a.push("active");
  if (disabled) a.push("disabled");
  a.push(big ? "lg" : "sm");
  return a.join(" ") + ":" + a.length;
}
if (global.__optimize) __optimize(classes);

inspect = function() {
  return [classes(true, false, true), classes(false, false, false), classes(1, 1, 0)].join(",");
};
