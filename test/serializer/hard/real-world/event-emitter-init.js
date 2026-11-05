// hard: real-world
// source: new (prototype-based class setup and listener registration at init)
// goal: evaluate class setup and registrations at build time; residual emit works; output <= 2x input
function Emitter() {
  this.handlers = {};
}
Emitter.prototype.on = function(type, fn) {
  (this.handlers[type] || (this.handlers[type] = [])).push(fn);
  return this;
};
Emitter.prototype.emit = function(type, arg) {
  var hs = this.handlers[type] || [];
  for (var i = 0; i < hs.length; i++) hs[i](arg);
  return hs.length;
};

var bus = new Emitter();
var seen = [];
bus
  .on("save", function(x) {
    seen.push("saved:" + x);
  })
  .on("save", function(x) {
    seen.push("audit:" + x);
  })
  .on("load", function(x) {
    seen.push("loaded:" + x);
  });

inspect = function() {
  var n = bus.emit("save", 1) + bus.emit("load", 2) + bus.emit("none", 3);
  return n + ":" + seen.join(",");
};
