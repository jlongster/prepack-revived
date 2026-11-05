// hard: P8
// source: new
// goal: a long concrete string built in a loop is either kept as a loop or emitted once (not duplicated); output <= 2x input
var sep = new Array(201).join("=");
var banner = sep + "\n" + "  report  " + "\n" + sep;

inspect = function() {
  return banner.length + ":" + banner.slice(0, 5);
};
