var SQ_TABLE = [];
for (var i = 0; i < 300; i++) {
  SQ_TABLE.push((i * 17 + 3) % 97);
}

var BIT_TABLE = (function() {
  var out = [];
  for (var n = 0; n < 200; n++) {
    var v = n;
    for (var k = 0; k < 4; k++) v = v & 1 ? 0x1234 ^ (v >>> 1) : v >>> 1;
    out[n] = v;
  }
  return out;
})();

// Post-loop mutation must invalidate loop recomputation and preserve exact mutated state.
var MUTATED = [];
for (var m = 0; m < 100; m++) {
  MUTATED.push(m * 2);
}
MUTATED[0] = 999;

// Exterior alias to an interior object must preserve exact object identity.
var SHARED_ITEMS = [];
for (var s = 0; s < 30; s++) {
  SHARED_ITEMS.push({ idx: s, label: "row-" + s });
}
var firstItemAlias = SHARED_ITEMS[0];

inspect = function() {
  return [
    SQ_TABLE.length,
    SQ_TABLE[0],
    SQ_TABLE[299],
    i,
    BIT_TABLE.length,
    BIT_TABLE[199],
    MUTATED[0],
    MUTATED[99],
    SHARED_ITEMS.length,
    firstItemAlias === SHARED_ITEMS[0],
    firstItemAlias.label,
  ].join("|");
};
