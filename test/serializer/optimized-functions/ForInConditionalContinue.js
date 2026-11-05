function render(f, g) {
  var s = { a: f, b: 1, c: g, d: 2 };
  var target = "";
  for (var k in s) {
    var v = s[k];
    if (v === 5) break;
    if (v == null) continue;
    target += k;
  }
  return target;
}

global.__optimize && __optimize(render);

inspect = function() {
  return [render(), render(1), render(1, 1), render(undefined, 1), render(5, 1), render(1, 5), render(null, 5)].join(
    "|"
  );
};
