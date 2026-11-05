// does not contain:regeneratorRuntime
(function() {
  let multiplier = 10;

  function* mapIterator(iter, mapFn) {
    for (const x of iter) {
      yield mapFn(x);
    }
  }

  function* flatMapIterator(iter, mapFn) {
    for (const x of iter) {
      const inner = mapFn(x);
      if (inner) yield* inner;
    }
  }

  let closedCount = 0;
  function* withCleanup() {
    try {
      yield "first";
      yield "second";
      yield "third";
    } finally {
      closedCount++;
    }
  }

  function* accumulator(initial = 0) {
    let total = initial;
    try {
      while (true) {
        let delta = yield total;
        total += delta * multiplier;
      }
    } catch (e) {
      return "caught:" + e + ":" + total;
    }
  }

  const srcMap = new Map([["preserve", 1], ["react", 2], ["react-jsx", 4]]);
  const inverseMap = new Map(mapIterator(srcMap.entries(), ([k, v]) => ["" + v, k]));
  const flatArr = Array.from(flatMapIterator([1, 2, 3], n => (n === 2 ? null : [n, n * 100])));

  let taken = [];
  for (const item of withCleanup()) {
    taken.push(item);
    if (item === "second") break;
  }

  const acc = accumulator(5);
  const step0 = acc.next().value;
  const step1 = acc.next(2).value;
  const step2 = acc.next(3).value;
  const stepThrow = acc.throw("stop");

  global.genInitSuite = {
    mapIterator,
    inverseEntries: Array.from(inverseMap.entries()),
    flatArr,
    taken,
    closedCount,
    steps: [step0, step1, step2, stepThrow.value, stepThrow.done],
  };
})();

inspect = function() {
  var s = global.genInitSuite;
  var runtimeMapped = Array.from(s.mapIterator([7, 8], x => x + 1));
  return JSON.stringify({
    inverseEntries: s.inverseEntries,
    flatArr: s.flatArr,
    taken: s.taken,
    closedCount: s.closedCount,
    steps: s.steps,
    runtimeMapped: runtimeMapped,
  });
};
