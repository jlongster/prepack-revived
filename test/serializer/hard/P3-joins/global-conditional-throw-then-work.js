// hard: P3
// source: variant of https://github.com/facebookarchive/prepack/issues/2561
// goal: a conditional throw at the top of module init must not poison the rest of initialization
var ok = global.__abstract ? __abstract("boolean", "(true)") : true;
var registry = {};
function init() {
  if (!ok) throw new Error("environment not supported");
  registry.a = { name: "A", deps: [] };
  registry.b = { name: "B", deps: ["a"] };
  registry.b.resolved = registry.b.deps.map(function(d) {
    return registry[d].name;
  });
}
init();

inspect = function() {
  return JSON.stringify(registry);
};
