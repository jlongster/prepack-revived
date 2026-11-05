// cannot serialize
(function() {
  global.p = new Promise(function() {});
})();

inspect = function() {
  return typeof global.p;
};
