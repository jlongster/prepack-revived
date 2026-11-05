function f(tree) {
  var walker = {
    total: 0,
    walk: function(node) {
      if (!node) return 0;
      return node.v + this.walk(node.l) + this.walk(node.r);
    },
  };
  return walker.walk(tree);
}
if (global.__optimize) __optimize(f);

inspect = function() {
  var t = { v: 1, l: { v: 2, l: null, r: { v: 3 } }, r: { v: 4 } };
  return [f(t), f(null), f({ v: 9 })].join(",");
};
