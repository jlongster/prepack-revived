// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/624
// goal: process.env reads are residual; dependent config branches are kept, not folded
// add at runtime:var process = { env: { NODE_ENV: "production", DEBUG: "1" } };
var isProd = process.env.NODE_ENV === "production";
var config = {
  minify: isProd,
  logLevel: process.env.DEBUG === "1" ? "debug" : isProd ? "error" : "info",
};

inspect = function() {
  return JSON.stringify(config);
};
