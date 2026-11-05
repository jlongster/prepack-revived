(function () {
  if (typeof globalThis === "object") return;
  Object.prototype.__defineGetter__("__magic__", function () {
    return this;
  });
  __magic__.globalThis = __magic__;
  delete Object.prototype.__magic__;
})();

globalThis.HandlebarsMini = {
  VERSION: "4.7.10",
  escapeExpression: function (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  },
};
