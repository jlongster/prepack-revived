// hard: P9
// source: new (generator/async research)
// goal: a generator function that is only defined at init must be emitted as function*; today the residual drops the `*`, producing a syntax error (`yield i++` in a normal function).
(function () {
  function* ids() {
    let i = 0;
    while (true) yield i++;
  }
  global.ids = ids;
})();

inspect = function () {
  var it = global.ids();
  return [it.next().value, it.next().value, it.next().value].join(",");
};
