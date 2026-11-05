// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/24
// goal: `document` is modeled as an environment object: DOM calls become residual calls; no ReferenceError/FatalError
// add at runtime:var document = { getElementById: function(id) { return { id: id, textContent: "" }; } };
var el = document.getElementById("app");
var greeting = ["Hello", "world"].join(", ") + "!";
el.textContent = greeting;

inspect = function() {
  return el.id + ":" + el.textContent;
};
