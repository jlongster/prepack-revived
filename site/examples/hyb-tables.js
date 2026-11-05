var T0 = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
var TT = (function () {
  var table = new Int32Array(1024);
  for (var n = 0; n < 256; n++) table[n] = T0[n];
  for (n = 0; n < 256; n++) {
    var v = T0[n];
    for (var c = 256 + n; c < 1024; c += 256) v = table[c] = (v >>> 8) ^ T0[v & 0xff];
  }
  var out = [];
  for (n = 1; n < 4; n++) out[n - 1] = table.subarray(n * 256, n * 256 + 256);
  return out;
})();
globalThis.crc = function (s) {
  var c = -1;
  for (var i = 0; i < s.length; i++) c = (c >>> 8) ^ T0[(c ^ s.charCodeAt(i)) & 0xff];
  return ~c >>> 0;
};
globalThis.views = TT;
