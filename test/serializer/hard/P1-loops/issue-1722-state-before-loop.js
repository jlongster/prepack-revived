// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/1722
// goal: keep the state built before the loop (keys 0 and 1) while widening the loop body; correct result
var n = global.__abstract ? __abstract("number", "(5)") : 5;
var arr = { 0: "a", 1: "b" };
var i = 2;
do {
  arr[i] = "x";
  i++;
} while (i < n);
var result = arr;

inspect = function() {
  return JSON.stringify(result) + " i=" + i;
};
