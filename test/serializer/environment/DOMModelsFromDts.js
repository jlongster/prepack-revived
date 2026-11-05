// add at runtime:var document = { childNodes: [1], createElement: function(t) { return { tagName: t.toUpperCase(), style: { animation: "" } }; }, getElementById: function(id) { return { id: id, className: "" }; } }; var navigator = { userAgent: "Mozilla/5.0 Chrome/120.0", language: "de-DE" };
var el = document.createElement("section");
var hasAnimStyle = "animation" in el.style;
var rootEl = document.getElementById("main");
if (rootEl) {
  rootEl.className = "ready-" + [1, 2].join("-");
}
var isChrome = /Chrome/.test(navigator.userAgent);
var langPrefix = navigator.language.split("-")[0];
var hasChildNodes = !!(document.childNodes && typeof document.childNodes !== "function");

inspect = function() {
  return [hasAnimStyle, rootEl.className, isChrome, langPrefix, hasChildNodes].join("|");
};
