// hard: real-world
// source: new (lodash-style library initialization)
// goal: evaluate the library setup at build time; output correct and <= 2x input
(function() {
  var root = typeof global !== "undefined" ? global : this;
  var objectToString = Object.prototype.toString;
  var _ = function(value) {
    return { __wrapped__: value };
  };
  _.VERSION = "4.17.0-mini";
  ["Arguments", "Function", "String", "Number", "Date", "RegExp", "Error"].forEach(function(name) {
    _["is" + name] = function(v) {
      return objectToString.call(v) === "[object " + name + "]";
    };
  });
  _.isArray = Array.isArray;
  _.identity = function(v) {
    return v;
  };
  var reEscape = /[&<>"']/g;
  var htmlEscapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  _.escape = function(s) {
    return String(s).replace(reEscape, function(ch) {
      return htmlEscapes[ch];
    });
  };
  _.templateSettings = { escape: /<%-([\s\S]+?)%>/g, evaluate: /<%([\s\S]+?)%>/g, variable: "" };
  _.times = function(n, fn) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(fn(i));
    return out;
  };
  root._ = _;
})();

inspect = function() {
  var _ = global._;
  return [
    _.VERSION,
    _.isString("a"),
    _.isNumber("a"),
    _.isDate(new Date(0)),
    _.isFunction(_.escape),
    _.escape("<a href='x'>&</a>"),
    _.times(3, String).join(""),
    _.templateSettings.escape.source,
  ].join(";");
};
