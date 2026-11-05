// hard: real-world
// source: new (tokenizer lookup table)
// goal: build a 128-entry character class table at init and use it from an optimized tokenizer over abstract input
var CHAR_CLASS = [];
for (var c = 0; c < 128; c++) {
  var ch = String.fromCharCode(c);
  CHAR_CLASS[c] = /[a-zA-Z_$]/.test(ch) ? 1 : /[0-9]/.test(ch) ? 2 : /\s/.test(ch) ? 3 : 0;
}

function countClasses(src) {
  var counts = [0, 0, 0, 0];
  for (var i = 0; i < src.length; i++) {
    var code = src.charCodeAt(i);
    counts[code < 128 ? CHAR_CLASS[code] : 0]++;
  }
  return counts.join(",");
}
if (global.__optimize) __optimize(countClasses);

inspect = function() {
  return countClasses("var x1 = 42; // é") + "|" + countClasses("");
};
