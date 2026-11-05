// prepack options: {"profileEnv":"node","fallbackMode":"throw"}
// does not contain:BROWSER_ONLY_BRANCH
var kind = typeof window === "undefined" ? "node-target" : "BROWSER_ONLY_BRANCH";
var hasIntl = typeof Intl === "object";

inspect = function() {
  return kind + ":" + hasIntl;
};
