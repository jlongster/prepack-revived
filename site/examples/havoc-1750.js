var cache = {};
function getEntry(arg) {
  cache[arg] = cache[arg] || { n: 0, key: arg };
  cache[arg].n++;
  return cache[arg].key + cache[arg].n;
}
if (global.__optimize) __optimize(getEntry);
