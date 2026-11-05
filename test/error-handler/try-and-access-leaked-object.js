// recover-from-errors
// expected errors: [{location: {"start":{"line":8,"column":12},"end":{"line":8,"column":14},"source":"test/error-handler/try-and-access-leaked-object.js"}, errorCode: "PP0021", severity: "RecoverableError", message: "Possible throw inside try/catch is not yet supported"},{location: {"start":{"line":9,"column":11},"end":{"line":9,"column":12},"identifierName":"o","source":"test/error-handler/try-and-access-leaked-object.js"}, errorCode: "PP0021", severity: "RecoverableError", message: "Possible throw inside try/catch is not yet supported"}]

function f(g) {
  var o = {};
  g(o);
  try {
    o.foo = 42;
    return o.bar;
  } catch (e) {
    return 42;
  }
}

if (global.__optimize) __optimize(f);

inspect = function() {
  return f(function(o) {
    o.bar = 7;
  });
};
