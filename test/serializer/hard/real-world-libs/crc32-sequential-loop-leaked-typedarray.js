// hard: P1
// source: real-world-libs (crc-32@1.2.2 crc32.js:48-60 slice_by_16_tables)
// goal: unroll or residualize concrete module-init table loops without leaking read-only TypedArray bindings into untyped Values (PP0037/PP0002)
// max size ratio: 6

(function(root) {
  var T0 = new Int32Array(256);
  T0[0] = 0;
  T0[1] = -306674912;

  function sliceBy16Tables(T) {
    var c = 0,
      v = 0,
      n = 0,
      table = new Int32Array(4096);
    for (n = 0; n != 256; ++n) table[n] = T[n];
    for (n = 0; n != 256; ++n) {
      v = T[n];
      for (c = 256 + n; c < 4096; c += 256) {
        v = table[c] = (v >>> 8) ^ T[v & 0xff];
      }
    }
    var out = [];
    for (n = 1; n != 16; ++n) {
      out[n - 1] = table.subarray(n * 256, n * 256 + 256);
    }
    return out;
  }

  var TT = sliceBy16Tables(T0);
  root.crcSubtables = {
    count: TT.length,
    len0: TT[0].length,
    sample: TT[0][1] ^ TT[14][1],
  };
})(typeof global !== "undefined" ? global : this);

inspect = function() {
  var s = global.crcSubtables;
  return [s.count, s.len0, s.sample].join(":");
};
