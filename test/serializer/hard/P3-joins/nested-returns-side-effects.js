// hard: P3
// source: variant of https://github.com/facebookarchive/prepack/issues/2354
// goal: returns under nested abstract conditions interleaved with side effects on a local log; correct join
function main(a, b, c) {
  var log = [];
  if (a) {
    log.push("a");
    if (b) {
      log.push("b");
      return log.join("");
    }
  }
  if (c) {
    log.push("c");
    if (!a) return log.join("") + "!";
  }
  log.push("end");
  return log.join("");
}
if (global.__optimize) __optimize(main);

inspect = function() {
  var r = [];
  for (var i = 0; i < 8; i++) r.push(main(i & 1, i & 2, i & 4));
  return r.join(",");
};
