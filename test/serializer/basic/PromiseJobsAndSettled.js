(function() {
  let log = [];
  let topLet = 100;

  let pChain = Promise.resolve(1)
    .then(x => {
      log.push("step1:" + x);
      return x + topLet;
    })
    .then(x => Promise.resolve(x * 2))
    .then(x => {
      log.push("step2:" + x);
      return {
        then(resolve) {
          resolve(x + 5);
        },
      };
    });

  let pCaught = Promise.reject("boom")
    .catch(err => {
      log.push("caught:" + err);
      return "recovered";
    })
    .finally(() => {
      log.push("finally");
    });

  let pRejectedHandled = Promise.reject("handled-err");
  pRejectedHandled.catch(e => {
    log.push("handled:" + e);
  });

  let pAll = Promise.all([Promise.resolve("a"), "b", pChain]);
  let pRace = Promise.race([Promise.resolve("fast"), Promise.resolve("slow")]);
  let pSettled = Promise.allSettled([Promise.resolve(10), Promise.reject("bad")]);

  async function asyncWrap(v) {
    return Promise.resolve(v + 1);
  }
  let pAsync = asyncWrap(41);

  for (let i = 0; i < 3; i++) {
    Promise.resolve(i).then(v => {
      log.push("loop:" + v);
    });
  }

  let pTagged = Promise.resolve("tagged");
  pTagged.tag = "meta";

  let cond = global.__abstract ? __abstract("boolean", "(true)") : true;
  let pCond = cond ? Promise.resolve(7) : Promise.resolve(8);

  function pureChain(x) {
    return Promise.resolve(x).then(v => v + 1);
  }
  if (global.__optimize) __optimize(pureChain);

  global.log = log;
  global.pChain = pChain;
  global.pCaught = pCaught;
  global.pRejectedHandled = pRejectedHandled;
  global.pAll = pAll;
  global.pRace = pRace;
  global.pSettled = pSettled;
  global.pAsync = pAsync;
  global.pTagged = pTagged;
  global.pCond = pCond;
  global.pureChain = pureChain;
})();

inspect = function() {
  return Promise.all([
    global.pChain,
    global.pCaught,
    global.pRejectedHandled.catch(e => "rej:" + e),
    global.pAll,
    global.pRace,
    global.pSettled,
    global.pAsync,
    global.pTagged,
    global.pCond,
    global.pureChain(20),
  ]).then(function(res) {
    return JSON.stringify({
      log: global.log,
      tag: global.pTagged.tag,
      res: res,
    });
  });
};
