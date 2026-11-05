// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/1378
// goal: switch on an abstract value is lowered like an if/else chain; no FatalError
function classify(v) {
  var r;
  switch (v) {
    case "a": {
      r = 1;
      break;
    }
    case "b": {
      r = 2;
      break;
    }
    default: {
      r = 3;
      break;
    }
  }
  return r;
}
if (global.__optimize) __optimize(classify);

inspect = function() {
  return ["a", "b", "c", 1].map(classify).join(",");
};
