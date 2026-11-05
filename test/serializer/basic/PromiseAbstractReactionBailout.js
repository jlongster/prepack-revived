// cannot serialize
(function() {
  let c = global.__abstract ? __abstract("boolean", "(true)") : true;
  let p = Promise.resolve(1);
  if (c) {
    p.then(function(x) {
      global.x = x;
    });
  }
  global.p = p;
})();

inspect = function() {
  return global.x;
};
