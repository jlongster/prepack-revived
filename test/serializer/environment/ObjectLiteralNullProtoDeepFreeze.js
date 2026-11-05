class HighlightError extends Error {
  constructor(msg, lang) {
    super(msg);
    this.lang = lang;
  }
}

function deepFreeze(obj) {
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(function(name) {
    var prop = obj[name];
    var type = typeof prop;
    if ((type === "object" || type === "function") && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  });
  return obj;
}

var MODES = Object.freeze({
  __proto__: null,
  STRING_MODE: { className: "string", begin: '"', end: '"' },
  NUMBER_MODE: { className: "number", begin: "\\b\\d+" },
  IDENT_RE: "[a-zA-Z_]\\w*",
});

for (var key in MODES) {
  if (typeof MODES[key] === "object") {
    deepFreeze(MODES[key]);
  }
}

var shorthandProto = (function(__proto__) {
  return { __proto__: __proto__ };
})({ tag: "protoObj" });

var computedProto = { ["__proto__"]: null };

global.hljsMini = {
  MODES: MODES,
  HighlightError: HighlightError,
  shorthandTag: shorthandProto.tag,
  hasOwnComputedProto: Object.prototype.hasOwnProperty.call(computedProto, "__proto__"),
};

inspect = function() {
  var err = new global.hljsMini.HighlightError("bad grammar", "rust");
  return [
    Object.getPrototypeOf(global.hljsMini.MODES) === null,
    "__proto__" in global.hljsMini.MODES,
    Object.isFrozen(global.hljsMini.MODES.STRING_MODE),
    global.hljsMini.MODES.STRING_MODE.className,
    err instanceof Error,
    err instanceof global.hljsMini.HighlightError,
    err.lang,
    global.hljsMini.shorthandTag,
    global.hljsMini.hasOwnComputedProto,
  ].join("|");
};
