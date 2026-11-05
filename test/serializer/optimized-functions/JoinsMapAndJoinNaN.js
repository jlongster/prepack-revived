// Join.mapAndJoin must handle NaN elements (whose `===` comparison is false) and conditions simplified to booleans.
function emptySwitch(a) {
  switch (a ? NaN : 0) {
  }
  return a;
}

function nonEmptySwitch(a, b) {
  switch (a ? NaN : b ? 0 : 1) {
    case 0:
      return "zero";
    case 1:
      return "one";
    default:
      return "nan";
  }
}

function refinedSwitch(a) {
  var v = a ? 1 : 2;
  if (a) {
    switch (v) {
      case 1:
        return "one";
      case 2:
        return "two";
    }
  }
  return "other";
}

function leakedUninitializedInTry(g) {
  var x;
  try {
    g(function() {
      return x;
    });
  } catch (e) {
    return [x, e.message];
  }
  return [x];
}

if (global.__optimize) {
  __optimize(emptySwitch);
  __optimize(nonEmptySwitch);
  __optimize(refinedSwitch);
  __optimize(leakedUninitializedInTry);
}

inspect = function() {
  return JSON.stringify([
    emptySwitch(0),
    emptySwitch(1),
    emptySwitch("x"),
    nonEmptySwitch(true, true),
    nonEmptySwitch(false, true),
    nonEmptySwitch(false, false),
    refinedSwitch(true),
    refinedSwitch(false),
    leakedUninitializedInTry(function(r) {
      return r();
    }),
    leakedUninitializedInTry(function() {
      throw new Error("boom");
    }),
  ]);
};
