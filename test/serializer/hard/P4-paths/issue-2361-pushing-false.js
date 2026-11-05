// hard: P4
// source: https://github.com/facebookarchive/prepack/issues/2361
// goal: no "Invariant: pushing false" when an infeasible branch is explored; drop infeasible branches
(function() {
  "use strict";

  function main(a1, a2, a3, a4, a5, a6) {
    var a = a1 ? a2 : false;
    var b = a ? a3 : false;
    if (b) {
      var c = a4 ? a5 : null;
      var d = c ? a6 : null;
      var e = a4 ? a4 : true;
      var f = d ? e : true;
      if (f) {
        return "f";
      }
      return "not f";
    }
    return "not b";
  }

  if (global.__optimize) __optimize(main);
  global.main = main;
})();

inspect = function() {
  return [
    main(true, true, true, true, "", true),
    main(true, true, true, true, "x", true),
    main(true, true, true, 0, "x", 0),
    main(false, true, true, true, "x", true),
  ].join(",");
};
