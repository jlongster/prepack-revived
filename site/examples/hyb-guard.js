var root = typeof window !== "undefined" ? window : globalThis;
var isNode = typeof process !== "undefined" && process.versions != null;
var settings = {
  platform: isNode ? "node" : "browser",
  storage: typeof localStorage !== "undefined" ? "local" : "memory",
};
root.Settings = settings;
