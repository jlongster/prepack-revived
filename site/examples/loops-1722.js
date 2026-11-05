var n = global.__abstract ? __abstract("number", "n0") : n0;
var arr = { 0: "a", 1: "b" };
var i = 2;
do {
  arr[i] = "x";
  i++;
} while (i < n);
var result = arr;
