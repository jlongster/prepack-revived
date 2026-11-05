(function() {
  // 1. globalThis + Annex B __defineGetter__/__defineSetter__/__lookupGetter__/__lookupSetter__
  let box = {};
  let stored = 10;
  box.__defineGetter__("val", function() {
    return stored * 2;
  });
  box.__defineSetter__("val", function(v) {
    stored = v + 1;
  });
  box.val = 20;
  let getterFn = box.__lookupGetter__("val");
  let setterFn = box.__lookupSetter__("val");

  // 2. Object literal __proto__ (Annex B.3.1)
  let baseProto = { inherited: "yes" };
  let nullDict = { __proto__: null, a: 1, b: 2 };
  let nullKeys = [];
  for (let k in nullDict) nullKeys.push(k);
  let customObj = { __proto__: baseProto, own: 3 };
  let computedProtoProp = { ["__proto__"]: "own-prop" };

  // 3. Class topological order when Subclass is visited before BaseClass
  let holder = {};
  function setupClasses() {
    class BaseNode {
      constructor() {
        this.kind = "base";
      }
      static helper(x) {
        return x + "!";
      }
    }
    class ChildNode extends BaseNode {
      constructor(label) {
        super();
        this.label = BaseNode.helper(label);
      }
    }
    holder.Child = ChildNode;
  }
  setupClasses();

  // 4. Nested var destructuring reusing an already-initialized binding
  function nestedVarDestructure(input) {
    var s = "init";
    var {
      first: { s },
      second: { s },
    } = input;
    return s;
  }
  let destructured = nestedVarDestructure({ first: { s: "one" }, second: { s: "two" } });

  // 5. Modern RegExp flags (dotAll /s, unicode /u captures, named capture groups)
  let dotAllMatch = /^a.b$/s.test("a\nb");
  let uniExec = /(\w+)-(\d+)/u.exec("item-42");
  let namedExec = /(?<yr>\d{4})-(?<mo>\d{2})/.exec("2026-11");

  // 6. ES2019-ES2022 intrinsics
  let fromEnt = Object.fromEntries([["x", 10], ["y", 20]]);
  let hasOwnRes = [Object.hasOwn(fromEnt, "x"), Object.hasOwn(fromEnt, "toString")];
  let flattened = [1, [2, [3, 4]]].flat(2);
  let flatMapped = [1, 2, 3].flatMap(n => [n, n * 10]);
  let atRes = [flattened.at(-1), "hello".at(-2)];
  let trimmed = ["  hi  ".trimStart(), "  hi  ".trimEnd()];
  let symDesc = Symbol("my-sym").description;

  globalThis.langSuite = {
    hasGlobalThis: globalThis === global,
    boxVal: box.val,
    hasAccessors: typeof getterFn === "function" && typeof setterFn === "function",
    nullProtoIsNull: Object.getPrototypeOf(nullDict) === null,
    nullKeys,
    inherited: customObj.inherited + ":" + customObj.own,
    computedProtoOwn: Object.prototype.hasOwnProperty.call(computedProtoProp, "__proto__"),
    Child: holder.Child,
    destructured,
    dotAllMatch,
    uniCapture: uniExec ? uniExec[1] + ":" + uniExec[2] : "none",
    namedCapture: namedExec && namedExec.groups ? namedExec.groups.yr + "/" + namedExec.groups.mo : "none",
    fromEnt,
    hasOwnRes,
    flattened,
    flatMapped,
    atRes,
    trimmed,
    symDesc,
  };
})();

inspect = function() {
  var s = globalThis.langSuite;
  var child = new s.Child("ok");
  return JSON.stringify({
    hasGlobalThis: s.hasGlobalThis,
    boxVal: s.boxVal,
    hasAccessors: s.hasAccessors,
    nullProtoIsNull: s.nullProtoIsNull,
    nullKeys: s.nullKeys,
    inherited: s.inherited,
    computedProtoOwn: s.computedProtoOwn,
    child: child.kind + ":" + child.label,
    destructured: s.destructured,
    dotAllMatch: s.dotAllMatch,
    uniCapture: s.uniCapture,
    namedCapture: s.namedCapture,
    fromEnt: s.fromEnt,
    hasOwnRes: s.hasOwnRes,
    flattened: s.flattened,
    flatMapped: s.flatMapped,
    atRes: s.atRes,
    trimmed: s.trimmed,
    symDesc: s.symDesc,
  });
};
