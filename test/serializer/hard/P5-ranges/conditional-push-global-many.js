// hard: P5
// source: variant of https://github.com/facebookarchive/prepack/issues/1066
// goal: several conditional pushes in global init code (feature list); no FatalError; correct
var hasA = global.__abstract ? __abstract("boolean", "(true)") : true;
var hasB = global.__abstract ? __abstract("boolean", "(false)") : false;
var hasC = global.__abstract ? __abstract("boolean", "(true)") : true;
var features = [];
if (hasA) features.push("a");
if (hasB) features.push("b");
if (hasC) features.push("c");
features.push("base");
var featureCount = features.length;

inspect = function() {
  return features.join("+") + "=" + featureCount;
};
