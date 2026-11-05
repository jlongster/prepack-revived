// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/1003
// goal: setInterval/clearInterval at init keep their runtime semantics; no FatalError
var ticks = 0;
var handle = setInterval(function() {
  ticks++;
  if (ticks === 3) clearInterval(handle);
}, 1);

inspect = function() {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve("ticks=" + ticks);
    }, 300);
  });
};
