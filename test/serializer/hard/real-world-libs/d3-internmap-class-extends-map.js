// hard: serializer
// source: real-world-libs (internmap@2.0.3 via d3-scale@4.0.3: class InternMap extends Map)
// goal: serialize ES2015 subclasses of built-in Map/Set constructors without tripping ResidualHeapSerializer visited/serialized count invariant

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

global.InternMap = InternMap;

inspect = function() {
  var m = new global.InternMap([["A", 1], ["b", 2]], function(s) {
    return String(s).toLowerCase();
  });
  return [m instanceof Map, m.get("a"), m.get("B"), m.size].join(":");
};
