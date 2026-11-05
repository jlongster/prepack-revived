// hard: P4
// source: new
// goal: typeof checks refine the type of an abstract value along each path; no FatalError; correct
function describe(v) {
  if (typeof v === "number") return "n:" + (v + 1);
  if (typeof v === "string") return "s:" + v.toUpperCase();
  if (v == null) return "nil:" + (v === null);
  if (typeof v === "object") return "o:" + Object.keys(v).length;
  return "other";
}
if (global.__optimize) __optimize(describe);

inspect = function() {
  return [describe(1), describe("ab"), describe(null), describe(undefined), describe({ a: 1 }), describe(true)].join(",");
};
