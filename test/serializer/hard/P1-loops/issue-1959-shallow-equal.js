// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/1959
// goal: for-loop over Object.keys of abstract objects in pure scope; no bail-out of shallowEqual; correct result
var hasOwnProperty = Object.prototype.hasOwnProperty;

function is(x, y) {
  if (x === y) {
    return x !== 0 || y !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}

function shallowEqual(objA, objB) {
  if (is(objA, objB)) {
    return true;
  }

  if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
    return false;
  }

  var keysA = Object.keys(objA);
  var keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (var i = 0; i < keysA.length; i++) {
    if (!hasOwnProperty.call(objB, keysA[i]) || !is(objA[keysA[i]], objB[keysA[i]])) {
      return false;
    }
  }

  return true;
}

function foo(x, y) {
  if (shallowEqual(x, y)) {
    return 123;
  }
  return 456;
}

if (global.__optimize) __optimize(foo);

inspect = function() {
  var o = { a: 1 };
  return [foo({ a: 1, b: "x" }, { a: 1, b: "x" }), foo({ a: 1 }, { a: 2 }), foo(o, o), foo(null, {}), foo({ a: 1 }, { b: 1 })].join(",");
};
