(function() {
  "use strict";
  function main(a1, a2, a3) {
    if (a1) {
      if (a2) {
        return false;
      }
    }
    if (!a3) {
      return false;
    }
    return true;
  }
  if (global.__optimize) __optimize(main);
  global.main = main;
})();
