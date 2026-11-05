function f(n) {
  var count = 0;
  var out = [];
  function rec(k) {
    count++;
    out.push(k);
    return k <= 0 ? 0 : rec(k - 1) + 1;
  }
  var r = rec(n);
  return r + ":" + count + ":" + out.join("-");
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(0), f(3), f(6)].join(",");
};
