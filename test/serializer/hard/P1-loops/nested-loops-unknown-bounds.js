// hard: P1
// source: new
// goal: nested loops with two unknown bounds; residual nested loops; output <= 2x input
function grid(rows, cols) {
  var out = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < cols; c++) {
      row.push(r * cols + c);
    }
    out.push(row.join(" "));
  }
  return out.join("/");
}
if (global.__optimize) __optimize(grid);

inspect = function() {
  return [grid(2, 3), grid(0, 4), grid(3, 1)].join(";");
};
