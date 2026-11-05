// A read from a concrete lookup table with an index known to be in [0, 255] becomes one typed
// runtime read instead of a 256-way conditional chain.
// does not contain: : 254
let x = global.__abstract ? __abstract("number", "(1234)") : 1234;
let lut = [];
for (let i = 0; i < 256; i++) lut.push(i * 2 + 1);
global.lut = lut;
global.r = lut[x & 255] + 1;

inspect = function() {
  return global.r + ":" + global.lut.length + ":" + global.lut[3];
};
