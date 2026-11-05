// hard: P1
// source: variant of https://github.com/facebookarchive/prepack/issues/2055
// goal: while loop scanning an abstract string in global code; residual loop; correct slice
var s = global.__abstract ? __abstract("string", '("hello   ")') : "hello   ";
var end = s.length;
while (end > 0 && s[end - 1] === " ") {
  end--;
}
var trimmed = s.slice(0, end);

inspect = function() {
  return JSON.stringify(trimmed) + end;
};
