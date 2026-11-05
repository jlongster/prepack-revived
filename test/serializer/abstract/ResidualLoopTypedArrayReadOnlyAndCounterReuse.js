// Tests residual loop with read-only TypedArray binding, local counter reuse, and post-loop subarray/index reads.
(function() {
  var bound = global.__abstract ? __abstract("number", "(6)") : 6;
  var src = new Int32Array(8);
  for (var k = 0; k < 8; k++) src[k] = (k + 1) * 11;

  function buildSubtables(T, limit) {
    var n = 0;
    var table = new Int32Array(16);
    for (n = 0; n < limit; ++n) {
      table[n] = T[n] + 1;
    }
    var out = [];
    for (n = 1; n != 4; ++n) {
      out[n - 1] = table.subarray(n * 4, n * 4 + 4);
    }
    return {
      outCount: out.length,
      sub0Len: out[0].length,
      first: table[0],
      fifth: out[0][1],
    };
  }

  global.res = buildSubtables(src, bound);
  inspect = function() {
    var r = global.res;
    return [r.outCount, r.sub0Len, r.first, r.fifth].join(":");
  };
})();
