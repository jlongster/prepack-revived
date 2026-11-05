// does not contain:unleakedStringMeta

function testStringMethods(s, sub, pos, code) {
  var meta = { tag: "S", unleakedStringMeta: 1 };
  if (typeof s !== "string") return meta.tag + ":" + String(s);
  var parts = [
    s.charAt(pos),
    s.charCodeAt(pos),
    String(s.codePointAt(pos)),
    s.concat("!", sub),
    s.endsWith(sub),
    s.includes(sub),
    s.indexOf(sub, pos),
    s.lastIndexOf(sub),
    s.normalize("NFC"),
    s.padStart(6, "."),
    s.padEnd(6, "_"),
    "ab".repeat(2),
    s.slice(pos, pos + 3),
    s.startsWith(sub),
    s.substr(pos, 2),
    s.substring(pos, pos + 2),
    s.toLowerCase(),
    s.toUpperCase(),
    s.trim(),
    s.valueOf(),
    s.replace("-", "_"),
    s.replace(/-/g, "="),
    s.search(/[0-9]+/),
    String(s.match(/[a-z]+/i)),
    s.split("-").join(":"),
    s.split(/[- ]/, 2).join("/"),
    String.fromCharCode(code),
    String.fromCodePoint(code),
    ("pre-" + s).indexOf("pre-"),
    ("pre-" + s).startsWith("pre-"),
    (s + "-suf").endsWith("-suf"),
  ];
  return meta.tag + ":" + parts.join("|");
}

if (global.__optimize) __optimize(testStringMethods);

inspect = function() {
  return [
    testStringMethods(" Ab-12-cd ", "b-", 1, 65),
    testStringMethods("\uD83D\uDE00-x", "x", 0, 9731),
    testStringMethods("", "a", 0, 48),
    testStringMethods(Symbol("sym"), "", 0, 65),
    testStringMethods(-0, "", 0, 65),
    testStringMethods(null, "", 0, 65),
    testStringMethods(undefined, "", 0, 65),
  ].join("\n");
};
