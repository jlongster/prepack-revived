// A conditional return from a catch handler must still run the finalizer.
function f(a, log) {
  try {
    throw 1;
  } catch (e) {
    if (a) return "r";
    log.push("c");
  } finally {
    log.push("f");
  }
  return "n";
}

if (global.__optimize) __optimize(f);

inspect = function() {
  var l1 = [],
    l2 = [];
  var x = f(true, l1);
  var y = f(false, l2);
  return x + y + l1.join() + "|" + l2.join();
};
