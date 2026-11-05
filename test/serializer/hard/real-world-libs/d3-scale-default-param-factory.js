// hard: P8
// source: real-world-libs (d3-scale@4.0.3 / d3-array@3.2.5 UMD factory closures with ES2015 default parameters)
// goal: serialize multiple closure instances with ES2015 default/rest parameters in ResidualFunctions.spliceFunctions without crashing

function makeLinearScale(domainStart, scaleFactor) {
  return function scale(value = 0) {
    var shifted = value - domainStart;
    var scaled = shifted * scaleFactor;
    return Math.round(scaled * 100) / 100;
  };
}

global.scaleA = makeLinearScale(10, 2.5);
global.scaleB = makeLinearScale(0, 0.5);

inspect = function() {
  return [global.scaleA(), global.scaleA(14), global.scaleB(), global.scaleB(9)].join(",");
};
