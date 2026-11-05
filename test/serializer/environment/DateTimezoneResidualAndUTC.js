// does contain:getTimezoneOffset
// does contain:2020
var utcYear = new Date(Date.UTC(2020, 5, 15)).getUTCFullYear();
var iso = new Date("2020-01-15T12:30:00.000Z").toISOString();
var localMs = new Date(2020, 0, 1).getTime();
var localOff = new Date(2020, 6, 1).getTimezoneOffset();

inspect = function() {
  return [utcYear, iso, localMs === new Date(2020, 0, 1).getTime(), localOff === new Date(2020, 6, 1).getTimezoneOffset()].join("|");
};
