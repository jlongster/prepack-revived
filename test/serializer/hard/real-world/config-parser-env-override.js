// hard: real-world
// source: new (config parsing with runtime overrides)
// goal: defaults are folded at build time, the override string from the environment is parsed at runtime (residual loop)
var defaults = { host: "localhost", port: 80, debug: false };
var overrides = global.__abstract ? __abstract("string", '("port=9000;debug=true")') : "port=9000;debug=true";

function parseOverrides(s, base) {
  var cfg = {};
  for (var k in base) cfg[k] = base[k];
  var pairs = s.split(";");
  for (var i = 0; i < pairs.length; i++) {
    var kv = pairs[i].split("=");
    if (kv.length !== 2) continue;
    var v = kv[1];
    cfg[kv[0]] = v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v;
  }
  return cfg;
}

var config = parseOverrides(overrides, defaults);

inspect = function() {
  return JSON.stringify(config);
};
