// hard: P1
// source: new
// goal: do/while building an object with computed keys up to an unknown bound; residual loop, correct object
function build(n) {
  var o = { first: true };
  var i = 0;
  do {
    o["k" + i] = i * i;
    i++;
  } while (i < n);
  o.count = i;
  return o;
}
if (global.__optimize) __optimize(build);

inspect = function() {
  return JSON.stringify([build(0), build(3), build(5)]);
};
