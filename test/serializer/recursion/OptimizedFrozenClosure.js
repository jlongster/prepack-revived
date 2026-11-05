// throws introspection error
function opt(n) {
  var count = 0;
  function rec(k) {
    count++;
    return k <= 0 ? 0 : rec(k - 1);
  }
  Object.freeze(rec);
  rec(n);
  return count;
}
if (global.__optimize) __optimize(opt);

inspect = function() {
  return opt(3);
};
