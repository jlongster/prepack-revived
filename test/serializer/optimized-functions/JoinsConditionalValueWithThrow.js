// The value of a conditional expression or call whose evaluation may throw on some paths
// must be the join of the values of all normal paths, not just the value of the first one.
function A() {
  return "A";
}
function B(b) {
  if (b) throw new Error("x");
  return "B";
}

function f(a, b) {
  var x = a ? "A" : B(b);
  return x;
}

function g(a, b) {
  var h = a ? A : B;
  return h(b);
}

function k(a, b) {
  var h = a ? A : b ? B : undefined;
  return h();
}

if (global.__optimize) {
  __optimize(f);
  __optimize(g);
  __optimize(k);
}

inspect = function() {
  var r = [];
  [f, g, k].forEach(function(fn) {
    [[true, false], [false, true], [false, false]].forEach(function(args) {
      try {
        r.push(fn(args[0], args[1]));
      } catch (e) {
        r.push(e instanceof TypeError ? "TypeError" : e.message);
      }
    });
  });
  return r.join();
};
