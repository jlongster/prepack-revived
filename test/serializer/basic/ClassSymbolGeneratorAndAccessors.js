// Class methods keyed by symbols, generator methods, static methods and setter-only accessors
// (three.js Color/Vector3/BufferAttribute shapes).
class Vec {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  *[Symbol.iterator]() {
    yield this.x;
    yield this.y;
  }
  set needsUpdate(v) {
    this.flag = v;
  }
  static create(a, b) {
    return new Vec(a, b);
  }
}
global.Vec = Vec;

inspect = function() {
  var v = global.Vec.create(3, 4);
  v.needsUpdate = true;
  var d = Object.getOwnPropertyDescriptor(global.Vec.prototype, "needsUpdate");
  return [...v].join(",") + ":" + v.flag + ":" + typeof d.get + ":" + typeof d.set + ":" + typeof global.Vec.create;
};
