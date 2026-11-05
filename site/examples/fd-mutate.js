var registry = {};
function register(name, fn) { registry[name] = fn; }
register("double", function (x) { return x * 2; });
register("inc", function (x) { return x + 1; });
delete registry.inc;
if (!Array.prototype.last) {
  Array.prototype.last = function () { return this[this.length - 1]; };
}
globalThis.registry = registry;
