var root = typeof window !== "undefined" ? window : global;
var api = {
  hasFetch: typeof root.fetch === "function",
  name: "api",
};
