var counter = (function () {
  var count = 0;
  var log = [];
  function bump(by) { count += by; log.push(by); return count; }
  return {
    inc: function () { return bump(1); },
    add: function (n) { return bump(n); },
    history: function () { return log.join(","); },
  };
})();
counter.add(40);
counter.inc();
