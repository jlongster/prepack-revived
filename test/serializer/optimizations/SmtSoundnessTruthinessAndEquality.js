// Soundness regression tests for simplifier and path-condition rules caught by the Z3 audit.

function truthinessReturn(a) {
  if (a) return true;
  return false;
}

function conditionalStrictEq(c, x, y) {
  var v = c ? x : y;
  return [v === x, v === y].join(":");
}

function zeroNotStrictEq(x) {
  if (0 !== x) {
    return x ? "truthy" : "falsy";
  }
  return "zero";
}

function notStrictNullVsLooseNull(x) {
  if (!(x === null)) {
    return x == null;
  }
  return "was-null";
}

function negatedNullCoalesce(a) {
  return !(a == null ? 0 : a);
}

function negatedDeMorganUndefinedCheck(a, b) {
  var v = !a && !b ? undefined : a ? 3 : 1;
  return v !== undefined;
}

function crossBranchDisjunctionCache(a5, a6, a7, a53, a54) {
  var c = a5 ? a6 : a7;
  var p = a53 ? a54 : true;
  if (p || (!p && !c)) {
    var r1 = "init";
    if (c) {
      r1 = p ? "t1" : "f1";
    }
    return r1 + ":" + (p ? "t2" : "f2");
  }
  return "out";
}

if (global.__optimize) {
  __optimize(truthinessReturn);
  __optimize(conditionalStrictEq);
  __optimize(zeroNotStrictEq);
  __optimize(notStrictNullVsLooseNull);
  __optimize(negatedNullCoalesce);
  __optimize(negatedDeMorganUndefinedCheck);
  __optimize(crossBranchDisjunctionCache);
}

inspect = function() {
  var vals = [0, -0, 1, "", "x", false, true, null, undefined, NaN, {}];
  return [
    vals.map(truthinessReturn).join(","),
    conditionalStrictEq(0, 5, 5),
    conditionalStrictEq(1, NaN, 5),
    conditionalStrictEq("yes", "a", "b"),
    vals.map(zeroNotStrictEq).join(","),
    [null, undefined, 0, false, ""].map(notStrictNullVsLooseNull).join(","),
    vals.map(negatedNullCoalesce).join(","),
    negatedDeMorganUndefinedCheck(2, 3),
    negatedDeMorganUndefinedCheck(0, 0),
    crossBranchDisjunctionCache(false, false, false, true, null),
    crossBranchDisjunctionCache(true, true, true, true, "ok"),
  ].join("|");
};
