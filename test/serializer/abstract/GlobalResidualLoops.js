var n = global.__abstract ? __abstract("number", "(4)") : 4;
var prebuilt = { 0: "zero", 1: "one", meta: "ok" };
var idx = 2;
do {
  prebuilt[idx] = "v" + idx;
  idx++;
} while (idx < n);

var squares = [];
for (var k = 0; k < n; k++) {
  squares[k] = k * k;
}

var str = global.__abstract ? __abstract("string", '("abc   ")') : "abc   ";
var end = str.length;
while (end > 0 && str[end - 1] === " ") {
  end--;
}
var trimmed = str.slice(0, end);

inspect = function() {
  return JSON.stringify({ prebuilt: prebuilt, idx: idx, squares: squares, trimmed: trimmed, end: end });
};
