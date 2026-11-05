(function() {
  "use strict";
  function main(a) {
    return !(a == null ? 0 : a);
  }
  if (global.__optimize) __optimize(main);
  global.main = main;
})();
