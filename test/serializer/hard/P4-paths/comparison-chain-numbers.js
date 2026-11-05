// hard: P4
// source: new
// goal: range-like comparisons on an abstract number select the right bucket; NaN handled; no dead buckets emitted
function bucket(n) {
  if (n < 0) return "neg";
  if (n < 10) return n >= 0 ? "small" : "dead1";
  if (n >= 10 && n < 100) return "mid";
  if (!(n < 100)) return "big";
  return "nan";
}
if (global.__optimize) __optimize(bucket);

inspect = function() {
  return [-1, 0, 9, 10, 99, 100, NaN].map(bucket).join(",");
};
