var isProd = process.env.NODE_ENV === "production";
var config = {
  minify: isProd,
  logLevel: process.env.DEBUG === "1" ? "debug" : isProd ? "error" : "info",
};
