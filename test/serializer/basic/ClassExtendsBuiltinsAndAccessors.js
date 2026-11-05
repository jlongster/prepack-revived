(function() {
  class InternMap extends Map {
    constructor(entries, key = d => d) {
      super();
      this._key = key;
      if (entries != null) {
        for (const [k, v] of entries) this.set(k, v);
      }
    }
    get(key) {
      return super.get(this._key(key));
    }
    set(key, value) {
      return super.set(this._key(key), value);
    }
  }

  class InternSet extends Set {
    constructor(values, key = d => d) {
      super();
      this._key = key;
      if (values != null) {
        for (const v of values) this.add(v);
      }
    }
    has(v) {
      return super.has(this._key(v));
    }
    add(v) {
      return super.add(this._key(v));
    }
  }

  class Vec extends Array {
    static get [Symbol.species]() {
      return Array;
    }
    sum() {
      let s = 0;
      for (let i = 0; i < this.length; i++) s += this[i];
      return s;
    }
  }

  class AppError extends Error {
    constructor(code, msg) {
      super(msg);
      this.code = code;
    }
  }

  class Bare extends null {}

  let state = 10;
  class Lexer {
    static get rules() {
      return { heading: "h1", state };
    }
    static set config(v) {
      state = v;
    }
    static lex(src) {
      return "lex:" + src;
    }
    get mode() {
      return "gfm:" + state;
    }
    set bump(delta) {
      state += delta;
    }
    ["foo bar"](x) {
      return x * 2;
    }
    values() {
      return [1, 2, 3];
    }
  }
  Lexer.prototype[Symbol.iterator] = Lexer.prototype.values;

  const bootMap = new InternMap([["X", 9]], s => String(s).toLowerCase());
  const bootSet = new InternSet(["HI"], s => String(s).toLowerCase());
  const bootVec = new Vec(3, 4, 5);
  const bootErr = new AppError("E_INIT", "bad");

  global.InternMap = InternMap;
  global.InternSet = InternSet;
  global.Vec = Vec;
  global.AppError = AppError;
  global.Bare = Bare;
  global.Lexer = Lexer;
  global.lexFn = Lexer.lex;
  global.bootMap = bootMap;
  global.bootSet = bootSet;
  global.bootVec = bootVec;
  global.bootErr = bootErr;
})();

inspect = function() {
  var m = new global.InternMap([["A", 1], ["b", 2]], function(s) {
    return String(s).toLowerCase();
  });
  var st = new global.InternSet(["Foo"], function(s) {
    return String(s).toLowerCase();
  });
  var v = new global.Vec(1, 2, 3);
  var mapped = v.map(function(x) {
    return x * 10;
  });
  var err = new global.AppError("E_RUN", "oops");
  var lx = new global.Lexer();
  global.Lexer.config = 20;
  lx.bump = 5;
  var rulesDesc = Object.getOwnPropertyDescriptor(global.Lexer, "rules");
  var modeDesc = Object.getOwnPropertyDescriptor(global.Lexer.prototype, "mode");
  return [
    m instanceof Map,
    m instanceof global.InternMap,
    m.get("a"),
    m.get("B"),
    st instanceof Set,
    st.has("foo"),
    global.bootMap instanceof Map,
    global.bootMap instanceof global.InternMap,
    global.bootMap.get("x"),
    global.bootSet instanceof Set,
    global.bootSet.has("hi"),
    v instanceof Array,
    v.sum(),
    mapped instanceof Array,
    !(mapped instanceof global.Vec),
    global.bootVec instanceof global.Vec,
    global.bootVec.sum(),
    err instanceof Error,
    err instanceof global.AppError,
    err.code,
    err.message,
    global.bootErr instanceof Error,
    global.bootErr instanceof global.AppError,
    global.bootErr.code,
    Object.getPrototypeOf(global.Bare.prototype) === null,
    global.Lexer.rules.state,
    lx.mode,
    lx["foo bar"](7),
    lx[Symbol.iterator]().join("-"),
    global.lexFn("md"),
    rulesDesc.enumerable === false,
    modeDesc.enumerable === false,
  ].join("|");
};
