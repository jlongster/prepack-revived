// hard: P7
// source: new (build-time vs run-time environment)
// goal: Number.prototype.toLocaleString is not folded with the build machine locale
// runtime env: LANG=fr_FR.UTF-8 LC_ALL=fr_FR.UTF-8
var label = (1234567.891).toLocaleString() + " / " + new Date(Date.UTC(2020, 0, 15)).toLocaleDateString("en-US", { timeZone: "UTC" });

inspect = function() {
  return label;
};
