// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/24
// goal: DOM construction at init stays in program order as residual calls; computed strings are folded
// add at runtime:var document = { body: { children: [], appendChild: function(c) { this.children.push(c); } }, createElement: function(t) { return { tag: t, className: "", children: [], appendChild: function(c) { this.children.push(c); } }; } };
var items = ["home", "about", "contact"];
var nav = document.createElement("nav");
nav.className = "nav " + items.length;
for (var i = 0; i < items.length; i++) {
  var a = document.createElement("a");
  a.className = "item-" + items[i].toUpperCase();
  nav.appendChild(a);
}
document.body.appendChild(nav);

inspect = function() {
  var n = document.body.children[0];
  return n.tag + "." + n.className + ">" + n.children.map(function(c) {
    return c.tag + "." + c.className;
  }).join(" ");
};
