// hard: P6
// source: https://github.com/facebookarchive/prepack/issues/977
// goal: a write to a property of an abstract environment object must be visible to later reads
// add at runtime:var NativeEnvironment = { someStringProperty: "x" };
var env = global.__abstract
  ? __abstract({ someStringProperty: __abstract("string") }, "NativeEnvironment")
  : NativeEnvironment;
var p2 = env.someStringProperty + " " + env.someStringProperty;
env.someStringProperty = "abc";
var p3 = env.someStringProperty + " " + env.someStringProperty;

inspect = function() {
  return p2 + "|" + p3;
};
