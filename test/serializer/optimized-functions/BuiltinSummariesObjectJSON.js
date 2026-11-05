// does not contain:unleakedContainer

function testObjectAndJSON(x, y, key, cond) {
  var meta = { v: 3, unleakedContainer: 1 };
  var lookup = { alpha: 1, beta: 2 };
  var container = {
    id: x,
    list: [y, undefined, -0, NaN, Infinity, "A", "global"],
    omitUndef: undefined,
    omitFn: function() {},
    unleakedContainer: undefined,
  };
  var same = [
    Object.is(x, y),
    Object.is(x, -0),
    Object.is(x, NaN),
    Object.is(meta, "str"),
    Object.prototype.hasOwnProperty.call(lookup, key),
    Object.prototype.hasOwnProperty.call(x != null ? x : lookup, key),
    Object.prototype.toString.call(x),
    JSON.stringify(container),
    JSON.stringify(x),
  ];
  var localForKeys = { before: 1 };
  var chosen = cond ? localForKeys : { other: 2 };
  var ks = Object.keys(chosen);
  localForKeys.after = 3;
  return meta.v + ":" + same.join("|") + "|keys=" + ks.join(",") + ":" + localForKeys.after;
}

if (global.__optimize) __optimize(testObjectAndJSON);

inspect = function() {
  var withToJSON = {
    toJSON: function() {
      return "custom-json";
    },
  };
  var tagged = {};
  tagged[Symbol.toStringTag] = "Tagged";
  return [
    testObjectAndJSON(-0, +0, "alpha", true),
    testObjectAndJSON(-0, -0, "gamma", false),
    testObjectAndJSON(NaN, NaN, "beta", true),
    testObjectAndJSON(undefined, "ok", "toString", false),
    testObjectAndJSON(withToJSON, 42, "alpha", false),
    testObjectAndJSON(tagged, null, "beta", false),
  ].join("\n");
};
