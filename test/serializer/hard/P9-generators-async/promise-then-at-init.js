// hard: P9
// source: new (generator/async research); EnqueueJob in src/methods/promise.js is a no-op
// goal: promise reactions scheduled during init must still run (microtasks run right after the script); today the callback is dropped and the Promise is serialized as a fake object.
(function () {
  global.done = "pending";
  global.p = Promise.resolve(1).then(function (x) {
    global.done = x + 1;
  });
})();

inspect = function () {
  // The harness calls inspect() synchronously, so the dropped callback itself isn't observable here;
  // calling then() detects the fake Promise object.
  var ok;
  try {
    global.p.then(function () {});
    ok = "then-ok";
  } catch (e) {
    ok = "then-throws";
  }
  return String(global.done) + "," + ok;
};
