// does not contain:__constructor
(function() {
  function Record(name, kind, flag) {
    this.name = name;
    this.kind = kind;
    this.flag = flag;
    this.extra = null;
  }
  Record.prototype.describe = function() {
    return this.name + ":" + this.kind + ":" + this.flag;
  };

  var records = [
    new Record("a", 1, true),
    new Record("b", 1, false),
    new Record("c", 2, false),
    new Record("d", 1, false),
    new Record("e", 3, true),
    new Record("f", 1, false),
  ];

  // Frozen prototype with read-only property must still allow own-property overrides via { __proto__ } literal.
  var frozenProto = Object.freeze({ tag: "proto", ro: 10 });
  var customObjs = [];
  for (var i = 0; i < 6; i++) {
    var o = Object.create(frozenProto);
    Object.defineProperty(o, "ro", { value: i + 100, writable: true, enumerable: true, configurable: true });
    customObjs.push(o);
  }

  // Null-prototype dictionary and own "__proto__" data property.
  var dict = Object.create(null);
  dict.alpha = 1;
  var withOwnProtoProp = {};
  Object.defineProperty(withOwnProtoProp, "__proto__", {
    value: "own-value",
    writable: true,
    enumerable: true,
    configurable: true,
  });

  global.bundle = { records: records, customObjs: customObjs, dict: dict, withOwnProtoProp: withOwnProtoProp };
  inspect = function() {
    var b = global.bundle;
    var desc = b.records.map(function(r) {
      return r.describe();
    }).join(",");
    var ros = b.customObjs.map(function(o) {
      return o.tag + "=" + o.ro;
    }).join(",");
    var ownProtoDesc = Object.getOwnPropertyDescriptor(b.withOwnProtoProp, "__proto__");
    return [
      desc,
      ros,
      Object.getPrototypeOf(b.dict) === null,
      b.dict.alpha,
      ownProtoDesc && ownProtoDesc.value,
    ].join(" | ");
  };
})();
