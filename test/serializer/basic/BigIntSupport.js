(function() {
  const zero = 0n;
  const dec = 42n;
  const hex = 0xffn;
  const bin = 0b1010n;
  const oct = 0o77n;
  const sep = 1_000_000n;
  const huge = 90071992547409931234567890n;
  const negHuge = -90071992547409931234567890n;

  let mut = 10n;
  let postInc = mut++;
  let preInc = ++mut;
  let postDec = mut--;
  let preDec = --mut;
  mut += 5n;
  mut *= 3n;
  mut **= 2n;

  const arith = [
    10n + 20n,
    10n - 25n,
    6n * 7n,
    -17n / 5n,
    -17n % 5n,
    2n ** 64n,
    -dec,
  ].map(String);

  const bits = [
    (0b1100n & 0b1010n).toString(2),
    (0b1100n | 0b1010n).toString(2),
    (0b1100n ^ 0b1010n).toString(2),
    ~0n,
    ~5n,
    1n << 10n,
    -1024n >> 3n,
  ].map(String);

  const cmp = [
    1n < 2n,
    2n < 1n,
    1n < 1.5,
    2n < 1.5,
    9007199254740993n > 9007199254740992,
    1n < Infinity,
    1n > -Infinity,
    1n < NaN,
    1n > NaN,
    10n < "20",
    10n > "2",
    10n < "not-a-bigint",
    0n == 0,
    0n === 0,
    42n == "42",
    42n == "42.5",
    0n == false,
    1n == true,
    42n === 42n,
  ];

  const conv = [
    typeof zero,
    typeof Object(dec),
    Boolean(zero),
    Boolean(dec),
    !zero,
    !dec,
    String(negHuge),
    "v=" + hex,
    Number(dec),
    Number(Object(bin)),
    (255n).toString(16),
    BigInt(123).toString(),
    BigInt("0x10").toString(),
    BigInt(true).toString(),
    BigInt.asIntN(8, 255n).toString(),
    BigInt.asUintN(8, -1n).toString(),
    Object.prototype.toString.call(dec),
  ];

  function catchName(fn) {
    try {
      fn();
      return "no-throw";
    } catch (e) {
      return e.name;
    }
  }

  const errors = [
    catchName(() => +1n),
    catchName(() => 1n + 1),
    catchName(() => 1n - 1),
    catchName(() => 1n >>> 1n),
    catchName(() => 1n / 0n),
    catchName(() => 1n % 0n),
    catchName(() => 2n ** -1n),
    catchName(() => BigInt(1.5)),
    catchName(() => BigInt(NaN)),
    catchName(() => BigInt("12.3")),
    catchName(() => new BigInt(1)),
    catchName(() => JSON.stringify({ a: 1n })),
  ];

  const map = new Map();
  map.set(9007199254740993n, "big-key-1");
  map.set(9007199254740994n, "big-key-2");
  const set = new Set([0n, -0n, 1n]);

  function residualBigIntFn(x) {
    return x + 100n;
  }
  if (global.__optimize) __optimize(residualBigIntFn);

  global.bigSuite = {
    zero,
    dec,
    hex,
    bin,
    oct,
    sep,
    huge,
    negHuge,
    boxed: Object(77n),
    updates: [postInc, preInc, postDec, preDec, mut].map(String),
    arith,
    bits,
    cmp,
    conv,
    errors,
    mapLookup: map.get(9007199254740993n) + ":" + map.get(9007199254740994n),
    setSize: set.size + ":" + set.has(0n),
    residualBigIntFn,
  };
})();

inspect = function() {
  var s = global.bigSuite;
  return JSON.stringify({
    types: [typeof s.zero, typeof s.huge, typeof s.negHuge, typeof s.boxed],
    literals: [s.zero, s.dec, s.hex, s.bin, s.oct, s.sep, s.huge, s.negHuge, s.boxed.valueOf()].map(String),
    updates: s.updates,
    arith: s.arith,
    bits: s.bits,
    cmp: s.cmp,
    conv: s.conv,
    errors: s.errors,
    mapLookup: s.mapLookup,
    setSize: s.setSize,
    residualOut: String(s.residualBigIntFn(23n)),
  });
};
