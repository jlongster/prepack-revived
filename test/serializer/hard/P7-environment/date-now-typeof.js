// hard: P7
// source: new
// goal: Date.now() at init is a residual temporal value; facts about it (number, > 0) are derived, not guessed
var t0 = Date.now();
var boot = { stamp: t0, ok: typeof t0 === "number" && t0 > 1e12, year: new Date(t0).getUTCFullYear() >= 2018 };

inspect = function() {
  return boot.ok + "," + boot.year;
};
