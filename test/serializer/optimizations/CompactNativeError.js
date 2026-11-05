// does not contain:__constructor
// does not contain:CompactNativeError.js:
var absMsg = global.__abstract ? __abstract("string", "('bad input')") : "bad input";

var eEmpty = new Error();
var eBlank = new Error("");
var eTyped = new TypeError(absMsg);
var eCustom = new RangeError("out of bounds");
eCustom.code = "ERR_BOUNDS";

var eCustomStack = new SyntaxError("bad token");
eCustomStack.stack = "custom-stack-trace";

inspect = function() {
  return [
    Object.prototype.toString.call(eEmpty),
    Object.prototype.hasOwnProperty.call(eEmpty, "message"),
    eEmpty.message,
    Object.prototype.hasOwnProperty.call(eBlank, "message"),
    eBlank.message,
    eTyped instanceof TypeError,
    eTyped.message,
    typeof eTyped.stack,
    eCustom instanceof RangeError,
    eCustom.code,
    eCustom.message,
    eCustomStack.stack,
  ].join("|");
};
