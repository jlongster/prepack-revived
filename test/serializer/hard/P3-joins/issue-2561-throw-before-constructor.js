// hard: P3
// source: https://github.com/facebookarchive/prepack/issues/2561
// goal: a conditional throw earlier in the module must not make the constructor conditional; inline someMethod
function module() {
  var x = global.__abstract ? __abstract("boolean", "(true)") : true;

  // if the throw is remove, the string below gets inlined correctly
  if (!x) {
    throw new Error("An error");
  }

  var Component = (function() {
    function Component() {
      this.someMethod = function() {
        return "This should be inlined!";
      };
    }

    return Component;
  })();

  function fn(x) {
    var instance = new Component();
    return instance.someMethod();
  }

  global.__optimize && __optimize(fn);

  return fn;
}

global.result = module();

inspect = function() {
  return global.result();
};
