// hard: real-world
// source: new (precompiled template specialized with __optimize)
// goal: specialize the render function for the compiled template: the parts loop is unrolled into string concatenation
function compile(tpl) {
  var parts = tpl.split(/\{\{(\w+)\}\}/);
  return function(data) {
    var out = "";
    for (var i = 0; i < parts.length; i++) out += i % 2 ? String(data[parts[i]]) : parts[i];
    return out;
  };
}
var card = compile("<div class='card'><h1>{{title}}</h1><p>{{body}}</p><span>{{n}}</span></div>");
if (global.__optimize) __optimize(card);

inspect = function() {
  return card({ title: "T", body: "B", n: 1 }) + card({ title: "<x>", body: "", n: null });
};
