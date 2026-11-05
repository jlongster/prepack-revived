// hard: real-world
// source: new (Babel-lowered ES2015 classes with helpers)
// goal: Babel class helpers and an inheritance chain are evaluated at build time; correct; output <= 2x input
function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var d = props[i];
    d.enumerable = d.enumerable || false;
    d.configurable = true;
    if ("value" in d) d.writable = true;
    Object.defineProperty(target, d.key, d);
  }
}
function _createClass(C, protoProps) {
  if (protoProps) _defineProperties(C.prototype, protoProps);
  return C;
}
function _inherits(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype, {
    constructor: { value: subClass, writable: true, configurable: true },
  });
  Object.setPrototypeOf(subClass, superClass);
}

var Shape = (function() {
  function Shape(name) {
    _classCallCheck(this, Shape);
    this.name = name;
  }
  _createClass(Shape, [
    {
      key: "describe",
      value: function describe() {
        return this.name + " with area " + this.area().toFixed(1);
      },
    },
  ]);
  return Shape;
})();

var Circle = (function(_Shape) {
  _inherits(Circle, _Shape);
  function Circle(r) {
    _classCallCheck(this, Circle);
    var self = Object.getPrototypeOf(Circle).call(this, "circle") || this;
    self.r = r;
    return self;
  }
  _createClass(Circle, [
    {
      key: "area",
      value: function area() {
        return Math.PI * this.r * this.r;
      },
    },
  ]);
  return Circle;
})(Shape);

var unit = new Circle(1);

inspect = function() {
  return unit.describe() + "|" + new Circle(2).describe() + "|" + (unit instanceof Shape);
};
