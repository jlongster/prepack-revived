// hard: P4
// source: https://github.com/facebookarchive/prepack/issues/2563
// goal: x == null must not imply x === null (simplifier bug: undefined is not null)
var x = global.__abstract ? __abstract(undefined, "(undefined)") : undefined;
var a = "unset";
if (x == null) a = x === null;

inspect = function() {
  return String(a);
};
