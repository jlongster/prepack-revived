// hard: P7
// source: new
// goal: Math.random() at init must stay a runtime value (not a build-time constant); derived facts hold
// does contain:Math.random
var r = Math.random();
var id = "id-" + Math.floor(r * 1e6);
var ok = r >= 0 && r < 1 && id.indexOf("id-") === 0;

inspect = function() {
  return String(ok);
};
