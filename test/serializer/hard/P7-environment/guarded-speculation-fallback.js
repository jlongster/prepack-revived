// hard: P7
// source: new (guarded environment speculation — assumptions violated at runtime, fallback executes)
// goal: when runtime TZ violates the build-time timezoneOffset assumption, guard falls back to original code cleanly
// runtime env: TZ=Asia/Kolkata
// prepack options: {"assumptions":{"timezoneOffset":0}}
// max size ratio: 4
var localTs = new Date(2020, 0, 1).getTime();
var localOffset = new Date(2020, 6, 1).getTimezoneOffset();

inspect = function() {
  return localTs + "," + localOffset;
};
