// Instances created via {__proto__: C.prototype} must not be emitted before class C,
// even when C has a method keyed by a well-known symbol.
(function() {
  var white = { r: 1, g: 1, b: 1 };
  function build() {
    class Color {
      constructor(r, g, b) {
        this.isColor = true;
        this.r = r;
        this.g = g;
        this.b = b;
      }
      *[Symbol.iterator]() {
        yield this.r;
        yield this.g;
        yield this.b;
      }
      sum() {
        return this.r + this.g + this.b;
      }
    }
    Color.NAMES = white;
    return Color;
  }
  var colors = [];
  var early = { a: 0 };
  global.early = early;
  var Color = build();
  for (var i = 0; i < 6; i++) colors.push(new Color(i, i + 1, i + 2));
  global.colors = colors;
  global.Color = Color;
})();

inspect = function() {
  return JSON.stringify([
    global.colors.map(c => c.sum()),
    Array.from(global.colors[2]),
    global.colors[0] instanceof global.Color,
    global.Color.NAMES.r,
  ]);
};
