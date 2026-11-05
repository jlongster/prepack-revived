// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/24
// goal: `window` is an alias of the global object at runtime; feature detection must not be folded wrongly
// add at runtime:var window = this; var __hasFetch = true; this.fetch = function() { return "fetched"; };
var root = typeof window !== "undefined" ? window : global;
var api = {
  hasFetch: typeof root.fetch === "function",
  name: "api",
};

inspect = function() {
  return api.name + ":" + api.hasFetch;
};
