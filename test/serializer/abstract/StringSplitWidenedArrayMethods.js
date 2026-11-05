// Tests String.prototype.split widened string ArrayValue result, template literal interpolation, and prefix inequality.
(function() {
  var raw = global.__abstract ? __abstract("string", '("ab12cd")') : "ab12cd";
  var dotted = raw
    .substring(1)
    .split("")
    .join(".");
  var initType = `@@app/INIT/${dotted}`;
  var replaceType = `@@app/REPLACE/${dotted}`;

  var isAdd = initType === "ADD_ITEM";
  var isSameNamespace = initType === replaceType;

  var csv = global.__abstract ? __abstract("string", '("x,y,z")') : "x,y,z";
  var parts = csv.split(",");
  var hasY = parts.includes("y");
  var idxZ = parts.indexOf("z");
  var tailJoined = parts.slice(1).join("-");

  inspect = function() {
    return [
      initType.slice(0, 11) === "@@app/INIT/",
      dotted,
      isAdd,
      isSameNamespace,
      hasY,
      idxZ,
      tailJoined,
    ].join("|");
  };
})();
