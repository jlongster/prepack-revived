// A module-level instance of class A is created before class B, whose method captures it.
// The instance must be allocated after A's class definition (three.js `_m3 = new Matrix3()` pattern).
class Mat {
  constructor() {
    this.e = [1, 0, 0, 1];
  }
  det() {
    return this.e[0] * this.e[3] - this.e[1] * this.e[2];
  }
}
var tmp = new Mat();
class User {
  run() {
    return tmp.det();
  }
}
global.User = User;

inspect = function() {
  return new global.User().run() + ":" + (Object.getPrototypeOf(new global.User()) === global.User.prototype);
};
