// hard: P7
// source: new (build-time vs run-time environment)
// goal: locale-dependent formatting depends on the runtime locale; no FatalError, no build-locale folding
// runtime env: LANG=de_DE.UTF-8 LC_ALL=de_DE.UTF-8
var fmt = typeof Intl !== "undefined" ? new Intl.NumberFormat() : null;
var price = fmt ? fmt.format(1234.5) : "n/a";

inspect = function() {
  return price;
};
