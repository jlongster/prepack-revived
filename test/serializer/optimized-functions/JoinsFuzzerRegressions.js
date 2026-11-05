// Regression tests for fuzzer-discovered join bugs in SwitchStatement, TryStatement, and composeCompletions.
function switchAbruptOnly(a1, a2) {
  switch (a2) {
    default:
      if (!a1) {
        throw new Error("t");
      } else {
        return 7;
      }
  }
}

function switchInfeasibleBreak(a1, a2, a3) {
  if (a2) throw new Error("a2");
  switch (a2) {
    case 0:
      break;
  }
  if (!a1) {
    switch (a3) {
      case 0:
        if (a3) return 0;
      default:
        if (a2) break;
    }
  }
  return "ok";
}

function tryConditionalThrowFinallyConditionalThrow(a1) {
  try {
    switch (a1) {
      case 0:
        (0).p0 += 0;
    }
  } finally {
    if (a1) throw new Error("fin");
  }
  return "done";
}

function tryUnmodeledThenModeledThrow(a2) {
  try {
    var x = a2.length;
    (0).push(x);
  } catch (e) {
    return "caught";
  }
}

function tryCreatedObjectsBeforeUnconditionalThrow(a2) {
  function fail() {
    throw new Error("fail");
  }
  try {
    var o = { p: [String(a2)] };
    if (fail()) return o;
  } catch (e) {
    return e.message;
  }
}

if (global.__optimize) {
  __optimize(switchAbruptOnly);
  __optimize(switchInfeasibleBreak);
  __optimize(tryConditionalThrowFinallyConditionalThrow);
  __optimize(tryUnmodeledThenModeledThrow);
  __optimize(tryCreatedObjectsBeforeUnconditionalThrow);
}

inspect = function() {
  var out = [];
  function run(fn, args) {
    try {
      out.push(String(fn.apply(null, args)));
    } catch (e) {
      out.push("err:" + (e instanceof TypeError ? "TypeError" : e.message));
    }
  }
  run(switchAbruptOnly, [false, 0]);
  run(switchAbruptOnly, [true, 0]);
  run(switchInfeasibleBreak, [false, 0, 0]);
  run(switchInfeasibleBreak, [false, 1, 0]);
  run(tryConditionalThrowFinallyConditionalThrow, [0]);
  run(tryConditionalThrowFinallyConditionalThrow, [1]);
  run(tryConditionalThrowFinallyConditionalThrow, [""]);
  run(tryUnmodeledThenModeledThrow, ["abc"]);
  run(tryUnmodeledThenModeledThrow, [null]);
  run(tryCreatedObjectsBeforeUnconditionalThrow, ["hi"]);
  return out.join("|");
};
