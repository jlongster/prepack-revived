// does not contain:DEAD_BRANCH
// does not contain:Object.assign

function pruneComparison(x) {
  if (x > 5) {
    if (x > 3) return "big";
    return "DEAD_BRANCH";
  }
  return "small";
}

function refineObjectType(v) {
  if (v == null) return "nil";
  if (typeof v === "object") return "obj:" + Object.keys(v).length;
  return "prim";
}

function postIncrement(x) {
  var before = x++;
  return before + ":" + x;
}

if (global.__optimize) {
  __optimize(pruneComparison);
  __optimize(refineObjectType);
  __optimize(postIncrement);
}

inspect = function() {
  return [
    [10, 5, -1, NaN, "9", "2"].map(pruneComparison).join(","),
    [null, undefined, { a: 1, b: 2 }, {}, 42, "hi"].map(refineObjectType).join(","),
    [0, "0", "abc", null, undefined, true].map(postIncrement).join(","),
  ].join("|");
};
