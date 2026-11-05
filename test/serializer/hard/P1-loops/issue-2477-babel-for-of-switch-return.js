// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/2477
// goal: return inside a Babel-lowered for-of + switch over abstract data; no PP0037-style "return in loop" bail-out
function fn(attachment) {
  for (
    var _iterator = attachment.style_list,
      _isArray = Array.isArray(_iterator),
      _i = 0,
      _iterator = _isArray
        ? _iterator
        : _iterator[typeof Symbol === "function" ? (typeof Symbol === "function" ? Symbol.iterator : "@@iterator") : "@@iterator"]();
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
    var style = _ref;
    switch (style) {
      case "A":
        return null;
      case "B":
        return "<b>" + attachment.title + "</b>";
      case "C":
        return "<c/>";
      case "H":
      case "I":
      case "J":
        return "<hij " + style + "/>";
    }
  }
  return "<default/>";
}

if (global.__optimize) __optimize(fn);

inspect = function() {
  return [
    fn({ style_list: ["Z", "B"], title: "t" }),
    fn({ style_list: [] }),
    fn({ style_list: ["A"] }),
    fn({ style_list: ["Q", "I", "C"] }),
  ].join(",");
};
