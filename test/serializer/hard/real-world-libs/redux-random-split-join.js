// hard: P6
// source: real-world-libs (redux@5.0.1 createStore/combineReducers randomString at module init)
// goal: String.prototype.split on an abstract string (from Math.random()) should preserve Array .join without FatalError PP0031

(function(root) {
  function randomString() {
    return Math.random()
      .toString(36)
      .substring(7)
      .split("")
      .join(".");
  }
  var initAction = "@@redux/INIT" + randomString();
  root.reduxStore = {
    hasPrefix: initAction.slice(0, 12) === "@@redux/INIT",
    reduce: function(state, type) {
      if (type === initAction) return state;
      return type === "INC" ? state + 1 : state;
    },
  };
})(typeof global !== "undefined" ? global : this);

inspect = function() {
  return global.reduxStore.hasPrefix + ":" + global.reduxStore.reduce(10, "INC");
};
