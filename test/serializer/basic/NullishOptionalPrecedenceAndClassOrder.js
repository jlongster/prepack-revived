// skip lint
(function() {
  // 1. Residual function with ?? inside ===, &&, ||, !, and ?. with non-primary bases
  function precedenceCheck(a, b, c, obj1, obj2, flag) {
    const r1 = (a ?? b) === 99 && 3 <= c && c <= 99;
    const r2 = ((a ?? b) && c) || (a && (b ?? c));
    const r3 = !(a ?? false);
    const r4 = (obj1 || obj2)?.tag;
    const r5 = (flag ? obj1 : obj2)?.tag;
    const r6 = (a ?? "ab")?.length;
    return [r1, r2, r3, r4, r5, r6].join("|");
  }

  // 2. Arrow function with custom property referenced before another arrow it captures
  function makeArrowOrder() {
    var first = x => second(x) + 1;
    Object.defineProperty(first, "name", { value: "computeValue", configurable: true });
    var holder = { fn: first };
    var second = y => y * 2;
    return { holder, second };
  }
  const arrowOrder = makeArrowOrder();

  // 3. Class with static singleton instance referenced inside class method
  function makeVersionClass() {
    class Version {
      constructor(major, minor) {
        this.major = major;
        this.minor = minor;
      }
      isZero() {
        return this.major === zero.major && this.minor === zero.minor;
      }
    }
    const zero = new Version(0, 0);
    Version.zero = zero;
    return Version;
  }
  const Version = makeVersionClass();

  // 4. Subclass visited before BaseClass across separate containers
  function makeHierarchy() {
    const exported = {};
    function build() {
      class Base {
        baseMethod() {
          return "base";
        }
      }
      class Sub extends Base {
        subMethod() {
          return this.baseMethod() + ":sub";
        }
      }
      exported.Sub = Sub;
      exported.laterRef = { Base };
    }
    build();
    return exported;
  }
  const hier = makeHierarchy();

  global.precSuite = {
    precedenceCheck,
    arrowOrder,
    Version,
    hier,
  };
})();

inspect = function() {
  var s = global.precSuite;
  var p1 = s.precedenceCheck(undefined, 99, 10, null, { tag: "from2" }, false);
  var p2 = s.precedenceCheck(5, 99, 10, { tag: "from1" }, { tag: "from2" }, true);
  var v = new s.Version(1, 2);
  var sub = new s.hier.Sub();
  return JSON.stringify({
    p1: p1,
    p2: p2,
    arrowName: s.arrowOrder.holder.fn.name,
    arrowVal: s.arrowOrder.holder.fn(10),
    zeroCheck: [s.Version.zero.isZero(), v.isZero()],
    subVal: sub.subMethod(),
  });
};
