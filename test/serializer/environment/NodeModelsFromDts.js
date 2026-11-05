// add at runtime:var process = { env: { NODE_ENV: "production" } }; var module = { exports: {} }; var require = function(id) { return id === "path" ? { sep: "/" } : {}; };
var path = require("path");
var joined = ["pkg", "dist", "index.js"].join(path.sep);
var prod = process.env.NODE_ENV === "production";
module.exports = {
  bundlePath: joined,
  prod: prod,
};

inspect = function() {
  return module.exports.bundlePath + ":" + module.exports.prod;
};
