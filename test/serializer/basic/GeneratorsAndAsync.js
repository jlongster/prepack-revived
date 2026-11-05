(function() {
  let base = 10;

  function* counter(start) {
    yield start + base;
    yield start + base + 1;
  }

  const genExpr = function*(items) {
    yield* items;
  };

  async function asyncVal(x) {
    return await Promise.resolve(x + base);
  }

  const asyncArrow = async y => y * 2;

  async function syncResolved() {
    return 42;
  }

  const obj = {
    *g() {
      yield "obj-g";
    },
    async a() {
      return "obj-a";
    },
    async *ag() {
      yield "obj-ag";
    },
  };

  class Worker {
    *steps() {
      yield 1;
      yield 2;
    }
    async compute(v) {
      return v + 1;
    }
    static *ssteps() {
      yield 3;
    }
    static async scompute(v) {
      return v + 2;
    }
  }

  function runInPure(flag) {
    if (flag) {
      return counter(5);
    }
    return asyncArrow(7);
  }
  if (global.__optimize) __optimize(runInPure);

  global.counter = counter;
  global.genExpr = genExpr;
  global.asyncVal = asyncVal;
  global.asyncArrow = asyncArrow;
  global.settled = syncResolved();
  global.genProtoTag = Object.getPrototypeOf(counter)[Symbol.toStringTag];
  global.asyncProtoTag = Object.getPrototypeOf(asyncVal)[Symbol.toStringTag];
  global.exportedGenProto = Object.getPrototypeOf(counter);
  global.exportedAsyncProto = Object.getPrototypeOf(asyncVal);
  global.obj = obj;
  global.Worker = Worker;
  global.runInPure = runInPure;
})();

inspect = function() {
  var it1 = global.counter(1);
  var it2 = global.genExpr([7, 8]);
  var it3 = global.obj.g();
  var w = new global.Worker();
  var it4 = w.steps();
  var it5 = global.Worker.ssteps();
  var p1 = global.asyncVal(5);
  var p2 = global.asyncArrow(6);
  var p3 = global.obj.a();
  var p4 = w.compute(9);
  var p5 = global.Worker.scompute(9);
  var pureGen = global.runInPure(true);
  var pureAsync = global.runInPure(false);
  var ag = global.obj.ag();
  return [
    it1.next().value,
    it1.next().value,
    it1.next().done,
    it2.next().value,
    it2.next().value,
    it3.next().value,
    it4.next().value,
    it5.next().value,
    typeof p1.then,
    typeof p2.then,
    typeof p3.then,
    typeof p4.then,
    typeof p5.then,
    typeof global.settled.then,
    typeof ag.next,
    pureGen.next().value,
    typeof pureAsync.then,
    global.genProtoTag,
    global.asyncProtoTag,
    global.exportedGenProto === Object.getPrototypeOf(function*() {}),
    global.exportedAsyncProto === Object.getPrototypeOf(async function() {}),
  ].join(",");
};
