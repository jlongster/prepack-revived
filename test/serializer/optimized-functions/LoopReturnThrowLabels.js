// Tests former PP0037 bail-out cases: return, throw, labels, arguments, this, and destructuring var in loops.
function searchAndAccumulate(limit) {
  var total = this.offset;
  outer: for (var r = 0; r < limit; r++) {
    for (var i = 1; i < arguments.length; i++) {
      var { tag, val } = arguments[i];
      if (tag === "skip") continue outer;
      if (tag === "stop") break outer;
      if (tag === "err") throw new Error("bad:" + val);
      if (tag === "ret") return total + val;
      total += val;
    }
  }
  return total;
}

function sumDestructuredForOf(items) {
  var acc = 0;
  for (var { a, b = 10 } of items) {
    acc += a + b;
  }
  return acc + ":" + a + ":" + b;
}

if (global.__optimize) {
  __optimize(searchAndAccumulate);
  __optimize(sumDestructuredForOf);
}

inspect = function() {
  var out = [];
  out.push(searchAndAccumulate.call({ offset: 5 }, 3, { tag: "add", val: 2 }, { tag: "add", val: 4 }));
  out.push(searchAndAccumulate.call({ offset: 1 }, 4, { tag: "add", val: 3 }, { tag: "skip", val: 0 }, { tag: "add", val: 99 }));
  out.push(searchAndAccumulate.call({ offset: 1 }, 4, { tag: "add", val: 3 }, { tag: "stop", val: 0 }, { tag: "add", val: 99 }));
  out.push(searchAndAccumulate.call({ offset: 2 }, 4, { tag: "add", val: 5 }, { tag: "ret", val: 100 }));
  try {
    searchAndAccumulate.call({ offset: 0 }, 2, { tag: "err", val: 7 });
  } catch (e) {
    out.push(e.message);
  }
  out.push(sumDestructuredForOf([{ a: 1, b: 2 }, { a: 4 }]));
  out.push(sumDestructuredForOf([]));
  return out.join("|");
};
