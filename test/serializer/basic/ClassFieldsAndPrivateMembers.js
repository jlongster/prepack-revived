// skip lint
(function() {
  let factor = 3;
  function setFactor(v) {
    factor = v;
  }

  const dynKey = "computedField";

  const Named = class Inner {
    uninitialized;
    base = 10;
    scaled = this.base * factor;
    [dynKey] = "dyn-ok";
    static registry = new Set(["a", "b"]);
    static make(x) {
      return new Inner(x);
    }
    constructor(extra = 0) {
      this.extra = extra;
    }
    total() {
      return this.scaled + this.extra;
    }
  };

  class Derived extends Named {
    childField = this.total() + 5;
    constructor(extra) {
      super(extra);
      this.afterSuper = this.childField + 1;
    }
  }

  class WithPrivates {
    #secret = 7;
    static #seed = 100;
    #double(n) {
      return (n + this.#secret) * factor;
    }
    get #val() {
      return this.#secret;
    }
    set #val(v) {
      this.#secret = v;
    }
    static #helper(z) {
      return z + WithPrivates.#seed;
    }
    compute(n, nextSecret) {
      const first = this.#double(n);
      this.#val = nextSecret;
      return [first, this.#val, this.#double(n), WithPrivates.#helper(5)].join(":");
    }
  }

  // Instance of public-fields class created at init time (just like `var v = new Marked()` in marked.js!)
  const bootInst = Named.make(4);

  // Also test private methods/fields executed at init time when instance does NOT escape to residual heap:
  const initPrivCheck = new WithPrivates().compute(2, 9);

  global.setFactor = setFactor;
  global.Named = Named;
  global.Derived = Derived;
  global.WithPrivates = WithPrivates;
  global.bootInst = bootInst;
  global.initPrivCheck = initPrivCheck;
})();

inspect = function() {
  global.setFactor(4);
  var n = global.Named.make(6);
  var d = new global.Derived(2);
  var p = new global.WithPrivates();
  return [
    "uninitialized" in global.bootInst,
    global.bootInst.uninitialized === undefined,
    global.bootInst.computedField,
    global.bootInst.total(),
    global.Named.registry.has("b"),
    n.total(),
    d.childField,
    d.afterSuper,
    global.initPrivCheck,
    p.compute(3, 11),
    Object.getOwnPropertySymbols(p).length,
  ].join("|");
};
