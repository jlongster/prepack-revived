// hard: P9
// source: new (generator/async research)
// goal: an async function defined (and called) at init must stay async: load() returns a Promise; p is a Promise. Today Prepack emits a plain function returning 1 and p = 1 (silent miscompile).
(function () {
  async function load() {
    return 1;
  }
  global.load = load;
  global.p = load();
})();

inspect = function () {
  var r = global.load();
  return [typeof r, typeof r.then, typeof global.p, typeof global.p.then].join(",");
};
