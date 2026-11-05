// does not contain:unleakedRegExpState

function testStatelessRegExp(s) {
  var re1 = /^([a-z]+)-(\d+)$/i;
  var reGlobalWord = /^global_([A-Z]+)$/;
  var state = { hits: 0, unleakedRegExpState: 99 };
  if (re1.test(s)) state.hits += 1;
  if (reGlobalWord.test(s)) state.hits += 10;
  var m1 = re1.exec(s);
  var m2 = re1.exec(s);
  var fresh = m1 && m2 ? m1 !== m2 : true;
  var group = m1 ? m1[1] + "#" + m1[2] : "none";
  return [state.hits, re1.lastIndex, fresh, group].join(":");
}

function testStatefulGlobalRegExp(s) {
  var re = /a+/g;
  var first = re.test(s);
  var idx1 = re.lastIndex;
  var second = re.test(s);
  var idx2 = re.lastIndex;
  return [first, idx1, second, idx2].join(":");
}

if (global.__optimize) {
  __optimize(testStatelessRegExp);
  __optimize(testStatefulGlobalRegExp);
}

inspect = function() {
  return [
    testStatelessRegExp("item-42"),
    testStatelessRegExp("global_OK"),
    testStatelessRegExp("nope"),
    testStatefulGlobalRegExp("baaacaa"),
    testStatefulGlobalRegExp("xyz"),
  ].join("\n");
};
