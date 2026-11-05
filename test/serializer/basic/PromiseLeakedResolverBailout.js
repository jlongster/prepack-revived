// cannot serialize
(function() {
  let savedResolve;
  new Promise(function(resolve) {
    savedResolve = resolve;
  });
  global.savedResolve = savedResolve;
})();

inspect = function() {
  return typeof global.savedResolve;
};
