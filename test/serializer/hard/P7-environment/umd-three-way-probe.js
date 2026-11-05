// hard: P7
// source: new (UMD wrapper probing exports/module/define/globalThis)
// goal: preserve UMD module-system probes (exports, module, define.amd, globalThis) without folding to a single host
// add at runtime:var exports = {}; var module = { exports: exports };
(function(root, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    factory(exports);
  } else if (typeof define === "function" && define.amd) {
    define(["exports"], factory);
  } else {
    var g = typeof globalThis !== "undefined" ? globalThis : root || self;
    factory((g.MyUMD = {}));
  }
})(this, function(exports) {
  var lookup = { a: 10, b: 20, c: 30 };
  exports.total = lookup.a + lookup.b + lookup.c;
  exports.format = function(tag) {
    return tag + "=" + exports.total;
  };
});

inspect = function() {
  return module.exports.format("sum");
};
