// does not contain:unleakedMarker

function testMath(x, y) {
  var local = { tag: "ok", unleakedMarker: 1 };
  var unary = [
    Math.abs(x),
    1 / Math.abs(x),
    Math.acos(x),
    Math.acosh(x),
    Math.asin(x),
    Math.asinh(x),
    Math.atan(x),
    Math.atanh(x),
    Math.cbrt(x),
    Math.ceil(x),
    1 / Math.ceil(x),
    Math.clz32(x),
    Math.cos(x),
    Math.cosh(x),
    Math.exp(x),
    Math.expm1(x),
    Math.floor(x),
    Math.fround(x),
    Math.log(x),
    Math.log1p(x),
    Math.log10(x),
    Math.log2(x),
    Math.round(x),
    1 / Math.round(x),
    Math.sign(x),
    1 / Math.sign(x),
    Math.sin(x),
    Math.sinh(x),
    Math.sqrt(x),
    Math.tan(x),
    Math.tanh(x),
    Math.trunc(x),
  ];
  var multi = [
    Math.atan2(x, y),
    Math.hypot(x, y),
    Math.imul(x, y),
    Math.max(x, y),
    1 / Math.max(x, y),
    Math.min(x, y),
    1 / Math.min(x, y),
    Math.pow(x, y),
  ];
  return (
    local.tag +
    ":" +
    unary
      .map(function(v) {
        return Number.isNaN(v) ? "NaN" : Object.is(v, -0) ? "-0" : v.toPrecision(6);
      })
      .join(",") +
    "|" +
    multi
      .map(function(v) {
        return Number.isNaN(v) ? "NaN" : Object.is(v, -0) ? "-0" : v.toPrecision(6);
      })
      .join(",")
  );
}

function testValueOfSideEffect(arg) {
  var keep = { k: 10, unleakedMarker: 2 };
  var res = Math.abs(arg);
  return keep.k + ":" + res;
}

if (global.__optimize) {
  __optimize(testMath);
  __optimize(testValueOfSideEffect);
}

inspect = function() {
  var sideEffects = 0;
  var objWithValueOf = {
    valueOf: function() {
      sideEffects++;
      return -12;
    },
  };
  var ignoreExtra = {
    valueOf: function() {
      throw new Error("extra arg must not be coerced");
    },
  };
  return [
    testMath(-0, +0),
    testMath(NaN, 2),
    testMath(-0.2, -1),
    testMath(0.5, 3),
    testMath(Infinity, -Infinity),
    testMath(" -4 ", true),
    testValueOfSideEffect(objWithValueOf),
    sideEffects,
    Math.abs(-5, ignoreExtra),
  ].join("\n");
};
