// throws introspection error
var globalCount = 0;
function opt(n) {
  function helper(k) {
    globalCount++;
    return k <= 0 ? 0 : entry(k - 1);
  }
  function entry(k) {
    return helper(k);
  }
  entry(n);
  return globalCount;
}
if (global.__optimize) __optimize(opt);

inspect = function() {
  return opt(3);
};
