// skip lint
// add at runtime:var customHostBridge = { version: "2.1", ping: function(x) { return "pong:" + x; } };
// does contain:typeof customHostBridge
var hasBridge = typeof customHostBridge !== "undefined";
var reply = hasBridge ? customHostBridge.ping("ok") : "none";

inspect = function() {
  return hasBridge + ":" + reply;
};
