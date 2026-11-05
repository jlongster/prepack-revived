// does not contain:unleakedArrayMeta
// does not contain:.knownTag

function testConcreteArrayOps(x, start, sep) {
  var meta = { ok: "M", unleakedArrayMeta: 1 };
  var table = ["a", 0, NaN, null, undefined, "a"];
  var r = [
    table.indexOf(x),
    table.lastIndexOf(x),
    table.lastIndexOf(x, undefined),
    table.includes(x),
    ["p", "q", "r"].indexOf(x, start),
    [1, -0, NaN, null, undefined, x].join(sep),
    [10, 20, 30, 40].slice(start, start + 2).join(","),
    Array.isArray(x),
    Array.isArray(x ? [1] : [2]),
    Array.isArray(x ? meta : null),
  ];
  return meta.ok + ":" + r.join("|");
}

function testGenericArrayCall(list, needle) {
  var box = { secret: 7, unleakedArrayMeta: 2 };
  var keyObj = { k: needle, knownTag: "TAG" };
  var idx = Array.prototype.indexOf.call(list, keyObj);
  var inc = Array.prototype.includes.call(list, needle);
  var joined = Array.prototype.join.call(list, "-");
  var sliced = Array.prototype.slice.call(list, 1);
  return [box.secret, keyObj.knownTag, keyObj.k, idx, inc, joined, sliced.length].join("|");
}

function testWidenedCallbacks(obj) {
  var log = [];
  var keys = Object.keys(obj);
  keys.forEach(function(k) {
    log.push(k);
  });
  var sum = keys.reduce(function(acc, k) {
    return acc + obj[k];
  }, 0);
  return log.join(",") + "=" + sum;
}

if (global.__optimize) {
  __optimize(testConcreteArrayOps);
  __optimize(testGenericArrayCall);
  __optimize(testWidenedCallbacks);
}

inspect = function() {
  return [
    testConcreteArrayOps("a", 1, ","),
    testConcreteArrayOps(NaN, 0, ";"),
    testConcreteArrayOps(-0, 2, undefined),
    testConcreteArrayOps([1, 2], 1, ":"),
    testGenericArrayCall(["x", "y", "z"], "y"),
    testGenericArrayCall("abc", "b"),
    testWidenedCallbacks({ a: 2, b: 5 }),
  ].join("\n");
};
