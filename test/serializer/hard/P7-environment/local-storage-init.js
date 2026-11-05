// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/24
// goal: localStorage reads at init are residual; JSON.parse fallback logic is kept
// add at runtime:var localStorage = { data: { state: '{"count":5}' }, getItem: function(k) { return k in this.data ? this.data[k] : null; } };
var saved = localStorage.getItem("state");
var missing = localStorage.getItem("other");
var state = saved ? JSON.parse(saved) : { count: 0 };
var other = missing ? JSON.parse(missing) : { count: 0 };

inspect = function() {
  return state.count + "," + other.count;
};
