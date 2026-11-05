// Tests concrete loop mutations on pre-allocated TypedArrays and subarray/DataView offset+length serialization.
(function() {
  var buf = new Int32Array(32);
  for (var i = 0; i < 32; i++) {
    buf[i] = (i + 1) * 1000 - (i % 2 === 0 ? 0 : 2000000);
  }
  var sub1 = buf.subarray(4, 12);
  var sub2 = buf.subarray(16);
  var dv = new DataView(buf.buffer, 8, 16);

  global.views = { sub1: sub1, sub2: sub2, dv: dv };
  inspect = function() {
    var v = global.views;
    return [
      v.sub1.length,
      v.sub1.byteOffset,
      v.sub1[0],
      v.sub1[7],
      v.sub2.length,
      v.sub2[0],
      v.dv.byteOffset,
      v.dv.byteLength,
      v.dv.getInt32(0, true),
      v.sub1.buffer === v.sub2.buffer,
    ].join(":");
  };
})();
