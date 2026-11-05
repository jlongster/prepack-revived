// throws introspection error
var sharedObj = { inner: { count: 0 } };
function rec(k) {
  var x = sharedObj.inner;
  x.count++;
  return k <= 0 ? 0 : rec(k - 1);
}
function opt(n) {
  rec(n);
  return sharedObj.inner.count;
}
if (global.__optimize) __optimize(opt);

inspect = function() {
  return [opt(2), opt(3)].join(",");
};
