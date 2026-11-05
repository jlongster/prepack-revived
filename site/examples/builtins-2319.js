function classify(s, n) {
  var re = /^[a-z]+$/;
  var meta = { kind: "other", size: 0 };
  if (re.test(s)) meta.kind = "word";
  meta.size = parseInt(n, 10) + Math.abs(-2);
  return meta.kind + ":" + meta.size + ":" + [10, 12, 14].indexOf(meta.size);
}
if (global.__optimize) __optimize(classify);
