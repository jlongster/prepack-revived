function fmtCell(v) {
  if (v == null) return "-";
  if (typeof v === "number") return v < 0 ? "(" + -v + ")" : "#" + v;
  if (typeof v === "boolean") return v ? "T" : "F";
  if (typeof v === "string") return v.length > 4 ? v.slice(0, 4) + ".." : v;
  return "?";
}

function renderRow(r) {
  return (
    "<tr><td>" +
    fmtCell(r.c0) +
    "</td><td>" +
    fmtCell(r.c1) +
    "</td><td>" +
    fmtCell(r.c2) +
    "</td><td>" +
    fmtCell(r.c3) +
    "</td><td>" +
    fmtCell(r.c4) +
    "</td><td>" +
    fmtCell(r.c5) +
    "</td></tr>"
  );
}

function deadLeakedWrites(cb) {
  var state = 10;
  function readState() {
    return state;
  }
  cb(readState);
  state = 1;
  state = 2;
  state = 3;
  state = 4;
  return state;
}

if (global.__optimize) {
  __optimize(renderRow);
  __optimize(deadLeakedWrites);
}

inspect = function() {
  var snapshots = [];
  var finalVal = deadLeakedWrites(function(fn) {
    snapshots.push(fn());
    global.__savedReader = fn;
  });
  snapshots.push(finalVal, global.__savedReader());
  return (
    renderRow({ c0: 5, c1: -3, c2: true, c3: "abcdef", c4: null, c5: {} }) +
    "|" +
    snapshots.join(",")
  );
};
