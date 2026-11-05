// hard: P1
// source: variant of https://github.com/facebookarchive/prepack/issues/1174
// goal: emit a residual loop in global code that fills an array up to an unknown bound; keep a[] contents correct
var n = global.__abstract ? __abstract("number", "(7)") : 7;
var a = [];
for (var i = 0; i < n; i++) {
  a[i] = i * 2;
}

inspect = function() {
  return a.join(",") + "|" + a.length;
};
