// prepack options: {"closedWorld":true}
// does not contain:typeof undeclaredClosedGlobal
var t = typeof undeclaredClosedGlobal;

inspect = function() {
  return t;
};
