// hard: real-world
// source: new (React Native / webpack style module registry, cf. #2561)
// goal: run module factories at build time, keep lazy init semantics and the abstract platform check; correct
var modules = {};
var cache = {};
function define(id, factory) {
  modules[id] = factory;
}
function requireModule(id) {
  if (cache[id]) return cache[id].exports;
  var module = (cache[id] = { exports: {} });
  modules[id](module, module.exports, requireModule);
  return module.exports;
}

var platform = global.__abstract ? __abstract("string", '("ios")') : "ios";

define("utils", function(module, exports) {
  exports.capitalize = function(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
});
define("platform", function(module) {
  module.exports = { OS: platform, select: function(o) { return platform in o ? o[platform] : o.default; } };
});
define("app", function(module, exports, require) {
  var utils = require("utils");
  var Platform = require("platform");
  if (Platform.OS !== "ios" && Platform.OS !== "android" && Platform.OS !== "web") {
    throw new Error("unsupported platform");
  }
  var greeting = utils.capitalize("hello");
  module.exports = {
    render: function() {
      return greeting + " from " + Platform.select({ ios: "iPhone", android: "Android", default: "Web" });
    },
  };
});

var app = requireModule("app");

inspect = function() {
  return app.render() + "|" + (requireModule("app") === app) + "|" + Object.keys(cache).join(",");
};
