// An index of an unknown string reads its character at runtime (it used to read String.prototype).
var s = global.__abstract ? __abstract("string", '("\\nab")') : "\nab";
var first = s[0];
var isNewline = s[0] === "\n";
var k = 2;
var third = s[k];
var outOfRange = s[7];
var notIndex = s["1.0"];
var len = s.length;

inspect = function() {
  return JSON.stringify([first, isNewline, third, outOfRange === undefined, notIndex === undefined, len]);
};
