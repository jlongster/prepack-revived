var config = { base: 10 };
function sum(node) {
  if (!node) return config.base;
  return node.v + sum(node.l) + sum(node.r);
}
function total(tree) {
  return sum(tree);
}
if (global.__optimize) __optimize(total);

inspect = function() {
  var t = { v: 1, l: { v: 2, l: null, r: null }, r: { v: 3, l: null, r: null } };
  return [total(t), total(null)].join(",");
};
