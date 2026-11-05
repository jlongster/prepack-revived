(function() {
  let sideEffects = 0;
  function bump() {
    sideEffects++;
    return "x";
  }

  const nullObj = null;
  const undefObj = undefined;
  const nested = {
    a: {
      b: [10, 20, 30],
      greet(suffix) {
        return this.tag + ":" + suffix;
      },
      tag: "ok",
    },
  };

  const r1 = nullObj?.a.b[bump()];
  const r2 = undefObj?.[bump()]?.(bump());
  const r3 = nested?.a?.b?.[1];
  const r4 = nested.a.greet?.("world");
  const r5 = nested.a.missing?.(bump());

  const delTarget = { p: { q: 1, keep: 2 } };
  const d1 = delete nullObj?.p.q;
  const d2 = delete delTarget?.p.q;

  const knownObj = global.__abstract ? __abstract({ k: 99 }, "({ k: 99 })") : { k: 99 };
  const knownRead = knownObj?.k;

  function optRead(input, fn) {
    let log = [];
    const val = input?.nested?.items?.[0];
    const called = fn?.(7);
    const methodRes = input?.run?.("go");
    const copy = { x: 1 };
    const maybeCopy = input ? copy : null;
    const delRes = delete maybeCopy?.x;
    log.push(val, called, methodRes, delRes, "x" in copy);
    return log.join("|");
  }
  if (global.__optimize) __optimize(optRead);

  global.staticResults = [r1, r2, r3, r4, r5, sideEffects, d1, d2, "q" in delTarget.p, delTarget.p.keep, knownRead];
  global.optRead = optRead;
})();

inspect = function() {
  var c1 = global.optRead(null, null);
  var c2 = global.optRead(undefined, undefined);
  var c3 = global.optRead(
    {
      nested: { items: [42] },
      prefix: "P",
      run: function(s) {
        return this.prefix + "-" + s;
      },
    },
    function(n) {
      return n * 3;
    }
  );
  var c4 = global.optRead({ nested: {} }, function(n) {
    return n + 1;
  });
  return global.staticResults.map(String).join(",") + "::" + [c1, c2, c3, c4].join(";;");
};
