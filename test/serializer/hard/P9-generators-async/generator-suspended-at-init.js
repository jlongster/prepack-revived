// hard: P9
// source: new (generator/async research)
// goal: a generator object created (and advanced) at init must still work afterwards; today calling next() at init is an invariant crash, and an unstarted generator object is serialized as a fake object.
(function () {
  function* ids() {
    let i = 0;
    while (true) yield i++;
  }
  var it = ids();
  global.first = it.next().value;
  global.it = it;
})();

inspect = function () {
  return [global.first, global.it.next().value, global.it.next().value].join(",");
};
