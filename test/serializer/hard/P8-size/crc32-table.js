// hard: P8
// source: new (classic init-time lookup table)
// goal: a 256-entry CRC32 table computed at init is cheaper to keep as code than as a literal; output <= 2x input
var CRC_TABLE = (function() {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(str) {
  var crc = 0 ^ -1;
  for (var i = 0; i < str.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  return (crc ^ -1) >>> 0;
}

inspect = function() {
  return crc32("hello world").toString(16);
};
