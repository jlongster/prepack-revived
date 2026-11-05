// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/24
// goal: requestAnimationFrame (absent from Prepack's model) is treated as an environment function
// add at runtime:var requestAnimationFrame = function(cb) { return setTimeout(function() { cb(16); }, 0); };
var frames = [];
requestAnimationFrame(function(t) {
  frames.push("frame@" + t);
});
var style = { width: 10 * 2 + "px" };

inspect = function() {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve(frames.join(",") + style.width);
    }, 20);
  });
};
