(function() {
  class BaseBox {
    constructor(x) {
      this.x = x;
    }
  }
  // Exercise field evaluation with abstract inputs inside an optimized function (no residual ES2022 class syntax -> passes eslint too!)
  function computeViaPrivateClass(a, b) {
    class Calc extends BaseBox {
      #offset = 10;
      doubled = this.x * 2;
      constructor(v, off) {
        super(v);
        if (off !== undefined) this.#offset = off;
      }
      #combine(k) {
        return this.doubled + this.#offset + k;
      }
      run(k) {
        return this.#combine(k);
      }
    }
    const c1 = new Calc(a);
    const c2 = new Calc(a, b);
    return c1.run(1) + ":" + c2.run(2);
  }
  if (global.__optimize) __optimize(computeViaPrivateClass);
  global.computeViaPrivateClass = computeViaPrivateClass;
})();

inspect = function() {
  return [global.computeViaPrivateClass(5, 20), global.computeViaPrivateClass(0, 3)].join(",");
};
