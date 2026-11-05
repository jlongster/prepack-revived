// Regression test: sound branch-isolated PathConditions on a Babel-lowered for-of + switch with returns
// must not blow up exponentially in ForBodyEvaluation / createJoinConditionForSelectedCompletions / negate
// or stall in Z3 fallback queries (#2053, #2477).

function scanItems(box) {
  for (
    var _iterator = box.items,
      _isArray = Array.isArray(_iterator),
      _i = 0,
      _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();
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
    switch (_ref) {
      case "stop":
        return "stopped";
      case "tag":
        return "<" + box.label + ">";
      case "one":
      case "two":
      case "three":
        return "num:" + _ref;
    }
  }
  return _isArray ? "arr-end" : "iter-end";
}

if (global.__optimize) __optimize(scanItems);

inspect = function() {
  var customIter = {};
  customIter[Symbol.iterator] = function() {
    var step = 0;
    var vals = ["skip", "two", "stop"];
    return {
      next: function() {
        return step >= vals.length ? { done: true } : { done: false, value: vals[step++] };
      },
    };
  };
  var emptyIter = {};
  emptyIter[Symbol.iterator] = function() {
    return {
      next: function() {
        return { done: true };
      },
    };
  };
  return [
    scanItems({ items: ["x", "tag"], label: "ok" }),
    scanItems({ items: ["x", "y"], label: "ok" }),
    scanItems({ items: [], label: "ok" }),
    scanItems({ items: customIter, label: "ok" }),
    scanItems({ items: emptyIter, label: "ok" }),
  ].join("|");
};
