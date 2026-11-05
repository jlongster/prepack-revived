// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/2226
// goal: assigning through a conditional object must consult setters on the prototype only on the matching path
var c = global.__abstract ? __abstract("boolean", "(false)") : false;
var proto = {
  set x(v) {
    this.y = 1;
  },
};
var obj = Object.create(proto);
var otherObj = {};
var abstractObj = c ? obj : otherObj;
abstractObj.x = 2;
var result = obj.y;

inspect = function() {
  return String(result) + "," + String(otherObj.x);
};
