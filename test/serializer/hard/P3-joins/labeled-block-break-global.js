// hard: P3
// source: variant of labeled-block-break.js
// goal: break out of a labeled block under an abstract condition in global code; correct join
var a = global.__abstract ? __abstract("boolean", "(false)") : false;
var b = global.__abstract ? __abstract("boolean", "(true)") : true;
var r = "start";
block: {
  if (a) break block;
  r += "-1";
  if (b) break block;
  r += "-2";
}

inspect = function() {
  return r;
};
