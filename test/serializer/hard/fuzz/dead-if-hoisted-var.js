// hard: P3
// source: fuzzer (extended mode, seed 198681013)
// goal: dead-branch elimination in ResidualFunctionInstantiator (`if (0) { var x; }`) must preserve hoisted `var` bindings
(function() {
  "use strict";

  function helper() {
    if (0) {
      var x = 1;
    }
    while (false) {
      var y = 2;
    }
    return [typeof x, x, y];
  }

  global.main = function() {
    return helper();
  };
})();

inspect = function() {
  return JSON.stringify(main());
};
