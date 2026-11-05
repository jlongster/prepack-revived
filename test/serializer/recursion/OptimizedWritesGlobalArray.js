// throws introspection error
var sharedArr = [];
function rec(k) {
  sharedArr.push(k);
  return k <= 0 ? 0 : rec(k - 1);
}
function opt(n) {
  rec(n);
  return sharedArr.length;
}
if (global.__optimize) __optimize(opt);

inspect = function() {
  return [opt(2), opt(3)].join(",");
};
