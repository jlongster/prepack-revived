function f(v) {
  var out = "";
  if (typeof v === "string" && v[0] === "\n") out += "\n";
  return out + v;
}

global.__optimize && __optimize(f);

inspect = function() {
  return JSON.stringify([f("\nx"), f("x"), f(""), f(12)]);
};
