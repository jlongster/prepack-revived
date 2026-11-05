// hard: real-world
// source: new (config parsing at init)
// goal: parse a constant INI string at build time; output is the parsed object, <= 2x input
var source = "[server]\nhost = example.org\nport = 8080\n\n[client]\nretries = 3\nverbose = true\n";

function parseIni(text) {
  var out = {};
  var section = out;
  text.split("\n").forEach(function(line) {
    line = line.trim();
    if (!line || line[0] === ";") return;
    var m = /^\[(.+)\]$/.exec(line);
    if (m) {
      section = out[m[1]] = {};
      return;
    }
    var eq = line.indexOf("=");
    var key = line.slice(0, eq).trim();
    var val = line.slice(eq + 1).trim();
    section[key] = val === "true" ? true : val === "false" ? false : /^\d+$/.test(val) ? +val : val;
  });
  return out;
}

var config = parseIni(source);

inspect = function() {
  return JSON.stringify(config);
};
