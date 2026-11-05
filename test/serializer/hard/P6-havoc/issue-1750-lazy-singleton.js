// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/1750
// goal: `cachedObject = cachedObject || {}` in an optimized function keeps singleton identity across calls
var cachedObject;
var created = 0;
function getInstance() {
  cachedObject = cachedObject || { id: ++created };
  return cachedObject;
}
if (global.__optimize) __optimize(getInstance);

inspect = function() {
  var a = getInstance();
  var b = getInstance();
  return (a === b) + ":" + a.id + ":" + created;
};
