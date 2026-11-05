// A conditional constructor is constructed on each side of the condition (#2561);
// a side that is not a constructor throws a TypeError.
function A() {
  this.v = "A";
}
function B() {
  this.v = "B";
}

function f(a, b) {
  var C = a ? A : b ? B : undefined;
  var o = new C();
  return o.v;
}

if (global.__optimize) __optimize(f);

inspect = function() {
  var r = [];
  [[true, false], [false, true], [false, false]].forEach(function(args) {
    try {
      r.push(f(args[0], args[1]));
    } catch (e) {
      r.push(e instanceof TypeError);
    }
  });
  return r.join();
};
