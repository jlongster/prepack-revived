// hard: P7
// source: real-world-libs (handlebars@4.7.10 dist/handlebars.js:2663)
// goal: model globalThis and Object.prototype.__defineGetter__ so the globalThis polyfill succeeds; never emit a throwing bundle with only Warning PP0023

(function() {
  if (typeof globalThis === "object") return;
  Object.prototype.__defineGetter__("__magic__", function() {
    return this;
  });
  __magic__.globalThis = __magic__; // eslint-disable-line no-undef
  delete Object.prototype.__magic__;
})();

globalThis.HandlebarsMini = {
  VERSION: "4.7.10",
  escapeExpression: function(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  },
};

inspect = function() {
  return globalThis.HandlebarsMini.VERSION + ":" + globalThis.HandlebarsMini.escapeExpression("a&<b>");
};
