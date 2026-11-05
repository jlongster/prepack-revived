// hard: P1
// source: new
// goal: labeled continue across nested loops with unknown bounds; no FatalError
function primesBelow(n) {
  var out = [];
  outer: for (var i = 2; i < n; i++) {
    for (var j = 2; j * j <= i; j++) {
      if (i % j === 0) continue outer;
    }
    out.push(i);
  }
  return out.join(" ");
}
if (global.__optimize) __optimize(primesBelow);

inspect = function() {
  return [primesBelow(20), primesBelow(2), primesBelow(3)].join("|");
};
