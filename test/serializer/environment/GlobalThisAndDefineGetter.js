var box = { _v: 10 };
box.__defineGetter__("double", function() {
  return this._v * 2;
});
box.__defineSetter__("double", function(x) {
  this._v = x / 2;
});
var hasGetter = typeof box.__lookupGetter__("double") === "function";
var hasSetter = typeof box.__lookupSetter__("double") === "function";
var first = box.double;
box.double = 30;
var second = box.double;

Object.prototype.__defineGetter__("__magic_self__", function() {
  return this;
});
var sameGlobal = __magic_self__ === globalThis; // eslint-disable-line no-undef
delete Object.prototype.__magic_self__;

inspect = function() {
  return [hasGetter, hasSetter, first, second, sameGlobal, typeof globalThis === "object"].join(",");
};
