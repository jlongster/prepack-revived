(function() {
  // 1. Optional catch binding + numeric separators + exponentiation
  let caughtCount = 0;
  try {
    throw new Error("ignored");
  } catch {
    caughtCount += 1_000;
  }
  let expVal = 2 ** 3 ** 2;
  expVal **= 1;

  // 2. Concrete nullish coalescing (preserving 0, "", false, NaN)
  const nc = [
    null ?? "def-null",
    undefined ?? "def-undef",
    0 ?? 99,
    "" ?? "non-empty",
    false ?? true,
    Number.isNaN(NaN ?? 5),
  ];

  // 3. Concrete logical assignment (setter must NOT fire when short-circuited!)
  let setterHits = 0;
  const box = {
    _a: 10,
    get a() {
      return this._a;
    },
    set a(v) {
      setterHits++;
      this._a = v;
    },
  };
  box.a ||= 99;
  box.a ??= 99;
  box.a &&= 25;

  let namedFn = null;
  namedFn ??= function() {
    return "named";
  };

  // 4. Abstract operands (both typed non-nullish and unknown top/conditional values)
  const absNum = global.__abstract ? __abstract("number", "(0)") : 0;
  const absNumCoal = absNum ?? 123;

  function evalModern(x, y, z) {
    const c = x ?? "fallback";
    let a = x;
    let b = y;
    let d = z;
    let rhsRuns = 0;
    a ||= (++rhsRuns, "or-default");
    b &&= (++rhsRuns, "and-updated");
    d ??= (++rhsRuns, "nullish-default");
    let ok = false;
    try {
      throw new Error("x");
    } catch {
      ok = true;
    }
    return [c, a, b, d, rhsRuns, ok].join(":");
  }
  if (global.__optimize) __optimize(evalModern);

  global.summary = [caughtCount, expVal, setterHits, box.a, namedFn.name, namedFn(), absNumCoal].concat(nc);
  global.evalModern = evalModern;
})();

inspect = function() {
  return [
    global.summary.map(String).join(","),
    global.evalModern(null, 1, undefined),
    global.evalModern(0, 0, 0),
    global.evalModern("", "yes", ""),
    global.evalModern(false, true, null),
    global.evalModern("boom", false, "kept"),
  ].join("||");
};
