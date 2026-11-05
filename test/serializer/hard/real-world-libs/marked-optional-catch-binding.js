// hard: language-feature
// source: real-world-libs (marked@18.1.3 lib/marked.umd.js:13:1308 lookbehind feature check)
// goal: parse ES2019 optional catch binding (catch { ... }) in src/utils/parse.js without FatalError PP1004

var supportsLookbehind = (function() {
  try {
    return !!new RegExp("(?<=1)(?<!1)a");
  } catch {
    return false;
  }
})();

global.markedFeature = {
  lookbehind: supportsLookbehind,
};

inspect = function() {
  return String(global.markedFeature.lookbehind);
};
