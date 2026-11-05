// hard: P3
// source: new (constructor that may throw, cf. #2561, #2502)
// goal: conditional throw inside a constructor caught by the caller; emit try/catch; correct
function Point(x, y) {
  if (x < 0 || y < 0) throw new RangeError("negative " + x + "," + y);
  this.x = x;
  this.y = y;
}
function make(x, y) {
  try {
    var p = new Point(x, y);
    return "ok:" + (p.x + p.y);
  } catch (e) {
    return e.name + ":" + e.message;
  }
}
if (global.__optimize) __optimize(make);

inspect = function() {
  return [make(1, 2), make(-1, 2), make(3, -4)].join(",");
};
