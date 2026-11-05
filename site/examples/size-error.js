var INVALID = new TypeError("Invalid config");
global.check = function (c) {
  if (!c) throw INVALID;
  return c;
};
