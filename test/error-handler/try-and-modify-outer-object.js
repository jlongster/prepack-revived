// expected errors: [{location: {"start":{"line":7,"column":2},"end":{"line":12,"column":3},"source":"test/error-handler/try-and-modify-outer-object.js"}, errorCode: "PP0021", severity: "RecoverableError", message: "Possible throw inside try/catch is not yet supported"}]

let outer = { x: 1 };
let g = global.__abstract ? __abstract("function", "(function() { return 7; })") : function() { return 7; };

function f() {
  try {
    outer.x = 2;
    return g();
  } catch (e) {
    return outer.x;
  }
}

if (global.__optimize) __optimize(f);

inspect = function() {
  return f() + ":" + outer.x;
};
