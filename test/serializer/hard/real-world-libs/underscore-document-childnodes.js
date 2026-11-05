// hard: P7
// source: real-world-libs (underscore@1.13.8 underscore-umd.js:139)
// goal: support reading document.childNodes during browser feature detection without FatalError PP0001
// add at runtime:var document = { childNodes: [] };

(function(root) {
  var isFunction = function(obj) {
    return Object.prototype.toString.call(obj) === "[object Function]";
  };
  var nodelist = root.document && root.document.childNodes;
  if (typeof /./ !== "function" && typeof Int8Array !== "object" && typeof nodelist !== "function") {
    isFunction = function(obj) {
      return typeof obj === "function" || false;
    };
  }
  root.underscoreIsFn = isFunction;
})(typeof self === "object" ? self : this);

inspect = function() {
  return [global.underscoreIsFn(function() {}), global.underscoreIsFn({}), global.underscoreIsFn(/abc/)].join(",");
};
