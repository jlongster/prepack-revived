var n = global.__abstract ? __abstract("number", "(-3.5)") : -3.5;
var s = global.__abstract ? __abstract("string", "('  101_item ')") : "  101_item ";
var b = global.__abstract ? __abstract("boolean", "(false)") : false;
var simpleObj = global.__abstract ? __abstract("object", "({ a: 1 })") : { a: 1 };
if (global.__makeSimple) __makeSimple(simpleObj);

var results = [
  Math.abs(n),
  Math.trunc(n),
  Math.imul(n, 2),
  parseInt(s, 2),
  parseFloat(s),
  isNaN(n),
  isFinite(n),
  Number(s),
  Number.isInteger(n),
  n.toFixed(1),
  n.toString(16),
  Boolean(n),
  b.toString(),
  b.valueOf(),
  s.trim().toUpperCase(),
  s.slice(2, 5),
  s.indexOf("101"),
  /101/.test(s),
  s.replace("_", "-").trim(),
  ["x", "y", s.trim()].indexOf("y"),
  ["x", s.trim()].join(":"),
  Object.is(n, -0),
  Object.prototype.toString.call(simpleObj),
  JSON.stringify({ n: n, s: s.trim() }),
];

inspect = function() {
  return results.join("|");
};
