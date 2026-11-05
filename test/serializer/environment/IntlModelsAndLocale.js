var nf = typeof Intl !== "undefined" ? new Intl.NumberFormat("en-US") : null;
var pr = typeof Intl !== "undefined" ? new Intl.PluralRules("en-US") : null;
var numText = nf ? nf.format(12500) : "fallback";
var cat = pr ? pr.select(1) : "one";
var locNum = (42.5).toLocaleString("en-US");
var locDate = new Date(Date.UTC(2021, 5, 10)).toLocaleDateString("en-US", { timeZone: "UTC" });

inspect = function() {
  return [numText, cat, locNum, locDate].join("|");
};
