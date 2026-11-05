// hard: P8
// source: https://github.com/facebookarchive/prepack/issues/2142
// goal: a callback passed to map on an abstract array is optimized, not dragged along with a large helper graph
function format(x) {
  return x < 10 ? "0" + x : String(x);
}
function render(list) {
  return list
    .map(function(item) {
      return "<li>" + format(item.h) + ":" + format(item.m) + "</li>";
    })
    .join("");
}
if (global.__optimize) __optimize(render);

inspect = function() {
  return render([{ h: 9, m: 5 }, { h: 12, m: 30 }]);
};
