// cannot serialize
(function() {
  class Counter {
    #n = 1;
    inc() {
      return ++this.#n;
    }
  }
  global.c = new Counter();
})();

inspect = function() {
  return global.c.inc();
};
