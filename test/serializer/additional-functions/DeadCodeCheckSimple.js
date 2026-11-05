// does not contain:thisShouldNotAppear

var simpleObj = global.__abstract ? __abstract("object", "({})") : {};
if (global.__makeSimple) __makeSimple(simpleObj);

function fn() {
  var a = simpleObj.thisShouldNotAppear;
  return 10;
}

global.__optimize && __optimize(fn);

inspect = function() {
  return fn();
};
