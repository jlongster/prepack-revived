// Annex B.3.1: `__proto__: v` in an object literal sets [[Prototype]], it does not create an own property.
var base = { greet: function() { return "hi"; } };
var o = { __proto__: base, own: 1 };
var n = { __proto__: null, a: 2 };
global.o = o;
global.n = n;

inspect = function() {
  return [
    global.o.greet(),
    Object.keys(global.o).join(","),
    Object.getPrototypeOf(global.n) === null,
    Object.keys(global.n).join(","),
  ].join("|");
};
