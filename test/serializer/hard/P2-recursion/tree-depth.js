// hard: P2
// source: new
// goal: recursive max-depth over abstract children arrays (recursion + loop); residual code; correct
function depth(node) {
  var d = 0;
  var kids = node.children || [];
  for (var i = 0; i < kids.length; i++) {
    var c = depth(kids[i]);
    if (c > d) d = c;
  }
  return d + 1;
}
if (global.__optimize) __optimize(depth);

inspect = function() {
  return [depth({}), depth({ children: [{}, { children: [{ children: [{}] }] }] })].join(",");
};
