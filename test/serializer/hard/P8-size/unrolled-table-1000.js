// hard: P8
// source: new (cost model: unroll vs keep loop)
// goal: a 1000-iteration init loop should not become a 1000-element literal; output <= 2x input
var table = [];
for (var i = 0; i < 1000; i++) {
  table.push((i * i) % 7);
}

inspect = function() {
  return table.length + ":" + table.slice(990).join("") + ":" + table.reduce(function(a, b) {
    return a + b;
  }, 0);
};
