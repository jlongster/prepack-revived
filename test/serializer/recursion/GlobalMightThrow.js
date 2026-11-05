// throws introspection error
var n = global.__abstract ? __abstract("number", "(5)") : 5;
function down(k) {
  if (k < 0) throw new Error("negative");
  return k === 0 ? 0 : down(k - 1);
}
var r = down(n);

inspect = function() {
  return r;
};
