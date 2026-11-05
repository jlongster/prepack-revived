// cannot serialize
(function() {
  async function f() {
    return await 1;
  }
  global.p = f();
})();

inspect = function() {
  return typeof global.p;
};
