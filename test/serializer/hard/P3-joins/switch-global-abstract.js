// hard: P3
// source: variant of https://github.com/facebookarchive/prepack/issues/1378
// goal: switch on an abstract string in global (initialization) code; no FatalError
var mode = global.__abstract ? __abstract("string", '("production")') : "production";
var config = { debug: false };
switch (mode) {
  case "development":
    config.debug = true;
    config.level = "verbose";
    break;
  case "test":
    config.level = "quiet";
    break;
  default:
    config.level = "warn";
}

inspect = function() {
  return JSON.stringify(config);
};
