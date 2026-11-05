// hard: P2
// source: new
// goal: recursive-descent expression parser over an abstract string; residual parser functions; correct value
function evaluate(src) {
  var pos = 0;
  function peek() {
    return src.charAt(pos);
  }
  function number() {
    var start = pos;
    while (pos < src.length && src.charAt(pos) >= "0" && src.charAt(pos) <= "9") pos++;
    return parseInt(src.slice(start, pos), 10);
  }
  function factor() {
    if (peek() === "(") {
      pos++;
      var v = expr();
      pos++;
      return v;
    }
    return number();
  }
  function term() {
    var v = factor();
    while (peek() === "*") {
      pos++;
      v = v * factor();
    }
    return v;
  }
  function expr() {
    var v = term();
    while (peek() === "+") {
      pos++;
      v = v + term();
    }
    return v;
  }
  return expr();
}
if (global.__optimize) __optimize(evaluate);

inspect = function() {
  return [evaluate("1+2*(3+4)"), evaluate("42"), evaluate("(1+1)*(2+2)")].join(",");
};
