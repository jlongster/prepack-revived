// Symbol-keyed reads on an array with widened numeric properties come from Array.prototype.
let s = global.__abstract ? __abstract("string", '("a,b")') : "a,b";
let parts = s.split(",");
global.same = parts[Symbol.iterator] === Array.prototype[Symbol.iterator];

inspect = function() {
  return String(global.same);
};
