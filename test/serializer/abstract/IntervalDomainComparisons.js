// does contain:alwaysTrue = true
// does contain:alwaysFalse = false
var b = global.__abstract ? __abstract("boolean", "(true)") : true;
var num = global.__abstract ? __abstract("number", "(NaN)") : NaN;
var str = global.__abstract ? __abstract("string", '("hello")') : "hello";

var ranged = b ? 3 : 7;
var sum = ranged + 2; // [5, 9]
var alwaysTrue = sum >= 5 && sum <= 9 && (str + "!!").length >= 2;
var alwaysFalse = sum > 10 || sum === 4 || (str + "!").length === 0;

// NaN-awareness: when !(num > 10), num could still be NaN, so num <= 20 must NOT fold to true,
// whereas num > 20 MUST fold to false.
var nanSafe;
if (num > 10) {
  nanSafe = "gt10";
} else {
  nanSafe = (num > 20 ? "bad" : "ok") + ":" + (num <= 20);
}

// -0 preservation through conditional and min/max.
function checkNegZero(flag) {
  var z = flag ? -0 : 0;
  return 1 / z + "," + 1 / Math.min(z, 0) + "," + 1 / Math.max(z, 0);
}
if (global.__optimize) __optimize(checkNegZero);

inspect = function() {
  return [alwaysTrue, alwaysFalse, nanSafe, checkNegZero(true), checkNegZero(false)].join(" | ");
};
