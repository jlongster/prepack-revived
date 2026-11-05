// throws introspection error
var globalArr = [];
function opt(n) {
  function helper(k) {
    globalArr.push(k);
    return k <= 0 ? 0 : entry(k - 1);
  }
  function entry(k) {
    return helper(k);
  }
  entry(n);
  return globalArr.length;
}
if (global.__optimize) __optimize(opt);

inspect = function() {
  return opt(3);
};
