var config = { debug: false, retries: 3, tags: ["a", "b"] };
var started = Date.now();
global.banner = "retries=" + config.retries + (config.debug ? " DEBUG" : "")
  + " tags=" + config.tags.join("+");
global.uptime = function () { return Date.now() - started; };
