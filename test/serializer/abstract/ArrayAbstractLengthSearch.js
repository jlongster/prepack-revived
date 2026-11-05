function searchOps(c1, c2, needle) {
  var a = [];
  if (c1) a.push("x");
  if (c2) a.push(NaN);
  a.push("y");
  a.push(undefined);
  var sparse = [,];
  if (c1) sparse.push("z");
  return [
    a.indexOf("y"),
    a.indexOf("missing"),
    a.indexOf(NaN),
    a.includes(NaN),
    a.includes("x"),
    a.includes("y"),
    a.indexOf(undefined),
    sparse.indexOf(undefined),
    sparse.includes(undefined),
    ["alpha", "beta", "gamma"].indexOf(needle),
    ["alpha", "beta", "gamma"].includes(needle),
  ].join(",");
}
if (global.__optimize) __optimize(searchOps);

inspect = function() {
  return [
    searchOps(true, true, "beta"),
    searchOps(true, false, "nope"),
    searchOps(false, true, "alpha"),
    searchOps(false, false, "gamma"),
  ].join(" | ");
};
