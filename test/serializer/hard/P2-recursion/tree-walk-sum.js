// hard: P2
// source: new
// goal: recursive walk of an abstract tree; residual recursive function; no stack-depth unrolling
function sum(node) {
  if (!node) return 0;
  return node.v + sum(node.l) + sum(node.r);
}
function total(tree) {
  return sum(tree);
}
if (global.__optimize) __optimize(total);

inspect = function() {
  var t = { v: 1, l: { v: 2, l: null, r: { v: 3 } }, r: { v: 4 } };
  return [total(t), total(null), total({ v: 9 })].join(",");
};
