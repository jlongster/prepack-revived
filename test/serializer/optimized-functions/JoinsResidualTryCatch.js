// Residual try/catch and try/finally around operations whose exceptions Prepack does not model (#1264, #2120).
function callInTry(g) {
  try {
    return "ok:" + g();
  } catch (e) {
    return "err:" + e.message;
  }
}

function leakedObjectInTry(g) {
  var o = {};
  g(o);
  try {
    o.foo = 42;
    return o.bar;
  } catch (e) {
    return 42;
  }
}

function localStateBeforeThrow(g) {
  var x = 0;
  var o = { y: 0 };
  try {
    x = 1;
    o.y = 10;
    var r = g();
    x = 2;
    o.y = 20;
    return r + ":" + x + ":" + o.y;
  } catch (e) {
    return "caught:" + x + ":" + o.y;
  }
}

function createdObjectInTry(g) {
  try {
    var v = g();
    return { ok: true, v: v };
  } catch (e) {
    return { ok: false, v: e.message };
  }
}

function mixedModeledAndUnmodeled(a, g) {
  try {
    if (a === 1) return "early";
    if (a === 2) throw new Error("modeled");
    return "g:" + g();
  } catch (e) {
    return "c:" + e.message;
  }
}

function catchThrowsRunsFinally(g, h, log) {
  try {
    return g();
  } catch (e) {
    return h(e);
  } finally {
    log.push("fin");
  }
}

if (global.__optimize) {
  __optimize(callInTry);
  __optimize(leakedObjectInTry);
  __optimize(localStateBeforeThrow);
  __optimize(createdObjectInTry);
  __optimize(mixedModeledAndUnmodeled);
  __optimize(catchThrowsRunsFinally);
}

inspect = function() {
  var ok = function() {
    return 7;
  };
  var boom = function() {
    throw new Error("boom");
  };
  var out = [
    callInTry(ok),
    callInTry(boom),
    leakedObjectInTry(function(o) {
      o.bar = 7;
    }),
    leakedObjectInTry(function(o) {
      Object.defineProperty(o, "foo", {
        set: function() {
          throw new Error("no");
        },
      });
    }),
    leakedObjectInTry(function(o) {
      Object.defineProperty(o, "bar", {
        get: function() {
          throw new Error("no");
        },
      });
    }),
    localStateBeforeThrow(ok),
    localStateBeforeThrow(boom),
    JSON.stringify(createdObjectInTry(ok)),
    JSON.stringify(createdObjectInTry(boom)),
    mixedModeledAndUnmodeled(1, boom),
    mixedModeledAndUnmodeled(2, ok),
    mixedModeledAndUnmodeled(3, ok),
    mixedModeledAndUnmodeled(3, boom),
  ];
  var log1 = [];
  out.push(catchThrowsRunsFinally(boom, ok, log1) + ":" + log1.join("+"));
  var log2 = [];
  try {
    catchThrowsRunsFinally(boom, boom, log2);
  } catch (e) {
    out.push("rethrown:" + e.message + ":" + log2.join("+"));
  }
  return out.join("|");
};
