// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/1750
// goal: an optimized function lazily populating a module-level cache keyed by an argument is handled soundly
var cache = {};
function getEntry(arg) {
  cache[arg] = cache[arg] || { n: 0, key: arg };
  cache[arg].n++;
  return cache[arg].key + cache[arg].n;
}
if (global.__optimize) __optimize(getEntry);

inspect = function() {
  return [getEntry("a"), getEntry("a"), getEntry("b"), getEntry("a")].join(",");
};
