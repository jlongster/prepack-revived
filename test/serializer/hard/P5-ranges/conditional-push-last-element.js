// hard: P5
// source: variant of https://github.com/facebookarchive/prepack/issues/1066
// goal: a[a.length - 1] after a conditional push resolves via range reasoning; correct
function last(c) {
  var a = [1];
  if (c) a.push(2);
  a.push(3);
  return a[a.length - 1] + a[0] * 10 + a.length * 100;
}
if (global.__optimize) __optimize(last);

inspect = function() {
  return [last(true), last(false)].join(",");
};
