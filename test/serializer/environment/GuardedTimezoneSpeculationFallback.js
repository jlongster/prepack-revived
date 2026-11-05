// prepack options: {"assumptions":{"timezoneOffset":0}}
// does contain:getTimezoneOffset
var off = new Date(2020, 6, 1).getTimezoneOffset();
var ts = new Date(2020, 0, 1).getTime();

global.inspect = function() {
  return off + ":" + ts;
};
