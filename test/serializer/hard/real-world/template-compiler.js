// hard: real-world
// source: new (tiny template compiler)
// goal: compile the template at build time into a closure chain; render with runtime data; output <= 2x input
function compile(tpl) {
  var parts = [];
  var re = /\{\{\s*(\w+)\s*\}\}/g;
  var last = 0;
  var m;
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) parts.push({ text: tpl.slice(last, m.index) });
    parts.push({ key: m[1] });
    last = re.lastIndex;
  }
  if (last < tpl.length) parts.push({ text: tpl.slice(last) });
  return function(data) {
    var out = "";
    for (var i = 0; i < parts.length; i++) {
      out += parts[i].text !== undefined ? parts[i].text : String(data[parts[i].key]);
    }
    return out;
  };
}

var greet = compile("Hello {{ name }}! You have {{count}} new {{ what }}.");

inspect = function() {
  return greet({ name: "Ada", count: 3, what: "messages" }) + "|" + greet({ name: "Bob", count: 0, what: "alerts" });
};
