// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/705
// goal: a module-level object passed to an abstract function is havoced; later reads are not constant-folded
// add at runtime:var externalHook = function(o) { o.count = 99; return 0; };
var hook = global.__abstract ? __abstract("function", "externalHook") : externalHook;
var registry = { count: 1 };
hook(registry);
var snapshot = registry.count;

inspect = function() {
  return String(snapshot);
};
