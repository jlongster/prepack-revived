var hasA = global.__abstract ? __abstract("boolean", "(true)") : true;
var hasB = global.__abstract ? __abstract("boolean", "(false)") : false;
var hasC = global.__abstract ? __abstract("boolean", "(!0)") : true;

var globalItems = [];
if (hasA) globalItems.push("a");
if (hasB) globalItems.push("b");
if (hasC) globalItems.push("c", "d");
globalItems.push("end");

function buildAndMutate(c1, c2) {
  var arr = ["start"];
  if (c1) arr.push("x");
  if (c2) arr.push("y", "z");
  arr.push("tail");
  var popped = arr.pop();
  var shifted = arr.shift();
  var joinedBeforeTrunc = arr.join("-");
  arr.length = 1;
  return [shifted, popped, joinedBeforeTrunc, arr.length, arr[0]].join("|");
}
if (global.__optimize) __optimize(buildAndMutate);

inspect = function() {
  return [
    globalItems.join("+") + ":" + globalItems.length,
    buildAndMutate(true, true),
    buildAndMutate(true, false),
    buildAndMutate(false, true),
    buildAndMutate(false, false),
  ].join(" / ");
};
