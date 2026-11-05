// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/624
// goal: Node's require/module are environment values: residualize require() and keep module.exports wiring
// add at runtime:var module = { exports: {} }; var require = function(n) { return n === "path" ? { sep: "/" } : null; };
var path = require("path");
var prefix = ["src", "lib"].join(path.sep);
module.exports = {
  join: function(a, b) {
    return prefix + path.sep + a + path.sep + b;
  },
};

inspect = function() {
  return module.exports.join("a", "b");
};
