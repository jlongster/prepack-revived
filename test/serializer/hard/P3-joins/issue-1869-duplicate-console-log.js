// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/1869
// goal: a return under an abstract condition in global code must not duplicate side effects (console.log)
(function() {
  var x = global.__abstract ? __abstract("number", "5") : 5;
  if (x == 5) {
    console.log("unique");
  } else {
    return;
  }
})();

inspect = function() {
  return "";
};
