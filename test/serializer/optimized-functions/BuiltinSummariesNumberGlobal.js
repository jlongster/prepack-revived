// does not contain:unleakedConfig

function testNumbers(s, r, n, u) {
  var cfg = { bonus: 5, unleakedConfig: true };
  var pi = parseInt(s, r);
  var pf = parseFloat(s);
  var num = Number(s);
  var bool = Boolean(u);
  var boolLocal = Boolean(u ? cfg : null);
  var checks = [
    isNaN(n),
    isFinite(n),
    Number.isNaN(n),
    Number.isFinite(n),
    Number.isInteger(n),
    Number.isSafeInteger(n),
    bool,
    boolLocal,
  ];
  var formatted =
    typeof n === "number"
      ? [n.toFixed(2), n.toExponential(1), n.toPrecision(3), n.toString(16), n.valueOf()].join("/")
      : "notnum";
  return [
    cfg.bonus,
    Object.is(pi, -0) ? "-0" : String(pi),
    Object.is(pf, -0) ? "-0" : String(pf),
    Object.is(num, -0) ? "-0" : String(num),
    checks.join(","),
    formatted,
  ].join("|");
}

function testURI(s) {
  var local = { prefix: "u:", unleakedConfig: 1 };
  var enc = encodeURIComponent(s);
  var dec = decodeURIComponent(enc);
  var encFull = encodeURI(s);
  var decFull = decodeURI(encFull);
  return local.prefix + enc + ":" + (dec === s) + ":" + (decFull === s);
}

if (global.__optimize) {
  __optimize(testNumbers);
  __optimize(testURI);
}

inspect = function() {
  var toStringCount = 0;
  var customStr = {
    toString: function() {
      toStringCount++;
      return "  -0x2a_rest";
    },
  };
  return [
    testNumbers("   -42px", 10, -0, 0),
    testNumbers(" \t\n0x1f", 0, NaN, ""),
    testNumbers("08", undefined, Infinity, "0"),
    testNumbers("-0", 10, 9007199254740991, null),
    testNumbers("  3.14e2!", 37, 9007199254740992, {}),
    testNumbers("", NaN, "42", NaN),
    testNumbers(customStr, 16, 12.5, false),
    toStringCount,
    testURI("https://example.com/a b?q=1&x=✓"),
  ].join("\n");
};
