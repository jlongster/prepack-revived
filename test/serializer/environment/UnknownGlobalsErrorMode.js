// prepack options: {"unknownGlobals":"error"}
// cannot serialize
var x = completelyUnmodeledGlobalVar + 1;
inspect = function() {
  return x;
};
