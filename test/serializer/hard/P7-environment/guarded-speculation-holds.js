// hard: P7
// source: new (guarded environment speculation — assumptions hold at runtime)
// goal: fold assumed environment facts and timezone offset at build time while emitting a runtime guard
// runtime env: TZ=Asia/Kolkata
// add at runtime:var process = { env: { NODE_ENV: "production" } };
// prepack options: {"assumptions":{"process.env.NODE_ENV":"production","timezoneOffset":-330},"fallbackMode":"throw"}
// does not contain:DEV_FALLBACK_PATH
// does contain:getTimezoneOffset
// does contain:1577817000000
// max size ratio: 3
var mode = process.env.NODE_ENV === "production" ? "prod" : "DEV_FALLBACK_PATH";
var istNewYear = new Date(2020, 0, 1).getTime();
var istOffset = new Date(2020, 6, 1).getTimezoneOffset();

inspect = function() {
  return [mode, istNewYear, istOffset].join(",");
};
