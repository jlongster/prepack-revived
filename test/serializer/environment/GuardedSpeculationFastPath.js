// prepack options: {"assumptions":{"process.env.NODE_ENV":"production","typeof window":"undefined"},"fallbackMode":"throw"}
// add at runtime:var process = { env: { NODE_ENV: "production" } };
// does not contain:DEV_ONLY_DIAGNOSTIC_TEXT
var banner =
  process.env.NODE_ENV === "production"
    ? "PROD_READY"
    : "DEV_ONLY_DIAGNOSTIC_TEXT";
var target = typeof window === "undefined" ? "server" : "client";
global.appInfo = banner + ":" + target;

inspect = function() {
  return global.appInfo;
};
