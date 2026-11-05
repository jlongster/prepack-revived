// hard: P7
// source: new (build-time vs run-time environment)
// goal: local-time Date computations depend on the runtime TZ and must not be folded with the build machine TZ
// runtime env: TZ=Asia/Kolkata
var newYear = new Date(2020, 0, 1).getTime();
var offset = new Date(2020, 6, 1).getTimezoneOffset();

inspect = function() {
  return newYear + "," + offset;
};
