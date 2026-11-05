(function() {
  "use strict";
  function main(a1) {
    if (a1) {
      return true;
    }
    return false;
  }
  if (global.__optimize) __optimize(main);
  global.main = main;
})();
