// A conditional throw that precedes a try statement must not be caught by its handler.
function f(a) {
  if (a) throw new Error("x");
  try {
    var y = 1;
  } catch (e) {
    return "caught";
  }
  return "ok" + y;
}

if (global.__optimize) __optimize(f);

inspect = function() {
  var r = [];
  [true, false].forEach(function(a) {
    try {
      r.push(f(a));
    } catch (e) {
      r.push("threw " + e.message);
    }
  });
  return r.join();
};
