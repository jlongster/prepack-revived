// does contain:typeof exports
// does contain:typeof define
(function(root, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    factory(exports);
  } else if (typeof define === "function" && define.amd) {
    define(["exports"], factory);
  } else {
    var g = typeof globalThis !== "undefined" ? globalThis : root || self;
    factory((g.UMDDemo = {}));
  }
})(this, function(exports) {
  var table = [1, 2, 3, 4].map(function(n) {
    return n * n;
  });
  exports.squares = table.join(",");
  exports.sum = function(extra) {
    return 1 + 4 + 9 + 16 + extra;
  };
});

inspect = function() {
  return global.UMDDemo.squares + ":" + global.UMDDemo.sum(5);
};
