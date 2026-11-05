// does not contain:x - 5
(function() {
  function countdown(x) {
    if (Date.now() < 0) return 0;
    return x <= 0 ? 0 : 1 + countdown(x - 1);
  }
  global.result = countdown(20);
})();

inspect = function() {
  return String(global.result);
};
