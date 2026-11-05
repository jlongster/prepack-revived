// hard: P3
// source: new
// goal: catch, inspect and rethrow errors from an abstract callback; emit try/catch; correct
function wrap(cb, tag) {
  try {
    return "v:" + cb();
  } catch (e) {
    if (e && e.retry) return "retry:" + tag;
    throw new Error(tag + ":" + e.message);
  }
}
if (global.__optimize) __optimize(wrap);

inspect = function() {
  var out = [];
  out.push(
    wrap(function() {
      return 1;
    }, "a")
  );
  out.push(
    wrap(function() {
      throw { retry: true };
    }, "b")
  );
  try {
    wrap(function() {
      throw new Error("boom");
    }, "c");
  } catch (e) {
    out.push(e.message);
  }
  return out.join(",");
};
