function curry2(fn) {
  return function f2(a, b) {
    switch (arguments.length) {
      case 0:
        return f2;
      case 1:
        return function(x) {
          return fn.call(this, a, x);
        };
      default:
        return fn.apply(this, arguments);
    }
  };
}

function makeScale(offset, factor) {
  return function scale(value = 10) {
    var shifted = value - offset;
    return Math.round(shifted * factor * 100) / 100;
  };
}

var add = curry2(function(a, b) {
  return a + b;
});
var sub = curry2(function(a, b) {
  return a - b;
});
var mul = curry2(function(a, b) {
  return a * b;
});
var pair = curry2(function(a, b) {
  return a + ":" + b;
});

var s1 = makeScale(2, 1.5);
var s2 = makeScale(5, 0.25);
var s3 = makeScale(-3, 2);

inspect = function() {
  return [
    add() === add,
    add(3)(4),
    add(3, 4),
    sub(10)(3),
    mul(6, 7),
    pair("k")("v"),
    s1(),
    s1(6),
    s2(),
    s2(9),
    s3(1),
  ].join("|");
};
