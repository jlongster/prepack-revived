// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/2055
// goal: residual while loop indexing an abstract string; no FatalError and no whole-function bail-out
function fn(props, splitPoint) {
  var text = props.text || "";

  text = text.replace(/\s*$/, "");

  if (splitPoint !== null) {
    while (text[splitPoint - 1] === "\n") {
      splitPoint--;
    }
  }
  return splitPoint;
}
if (global.__optimize) __optimize(fn);

inspect = function() {
  return [fn({ text: "ab\n\ncd" }, 4), fn({}, null), fn({ text: "a\n\n\nb" }, 4), fn({ text: "xyz" }, 2)].join(",");
};
