// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/2053
// goal: Babel-lowered for-of over an abstract iterable must terminate (infinite loop in Prepack today) and stay a loop
function fn(x) {
  var total = 0;
  for (
    var _iterator = x.items, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();
    ;

  ) {
    var _ref;

    if (_isArray) {
      if (_i >= _iterator.length) break;
      _ref = _iterator[_i++];
    } else {
      _i = _iterator.next();
      if (_i.done) break;
      _ref = _i.value;
    }

    var item = _ref;
    total += item;
  }
  return total;
}

if (global.__optimize) __optimize(fn);

inspect = function() {
  var it = {};
  it[Symbol.iterator] = function() {
    var n = 0;
    return {
      next: function() {
        n++;
        return n > 3 ? { done: true } : { done: false, value: n * 10 };
      },
    };
  };
  return [fn({ items: [1, 2, 3] }), fn({ items: [] }), fn({ items: it })].join(",");
};
