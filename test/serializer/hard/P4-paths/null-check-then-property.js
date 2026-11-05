// hard: P4
// source: new
// goal: guarded property reads (o != null && o.a) are emitted only under their guards; correct for null/undefined
function f(o) {
  var a = o != null && o.a;
  var b = o !== undefined ? (o === null ? "null" : o.b) : "undef";
  return String(a) + "," + String(b);
}
if (global.__optimize) __optimize(f);

inspect = function() {
  return [f(null), f(undefined), f({ a: 1, b: 2 }), f({})].join("|");
};
