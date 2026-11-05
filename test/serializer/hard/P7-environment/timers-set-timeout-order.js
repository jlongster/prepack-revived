// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/1003
// goal: setTimeout callbacks registered at init are residualized in order and run after sync code
var log = [];
setTimeout(function() {
  log.push("timeout-1");
}, 0);
log.push("sync");
setTimeout(function() {
  log.push("timeout-2:" + log.length);
}, 0);

inspect = function() {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve(log.join(","));
    }, 20);
  });
};
