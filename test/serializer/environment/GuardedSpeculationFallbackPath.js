// prepack options: {"assumptions":{"process.env.NODE_ENV":"production"}}
// add at runtime:var process = { env: { NODE_ENV: "development" } };
var mode = process.env.NODE_ENV === "production" ? "mode=prod" : "mode=dev";
var table = [2, 3, 5].map(function(x) {
  return x * 10;
});

global.inspect = function() {
  return mode + ":" + table.join(",");
};
