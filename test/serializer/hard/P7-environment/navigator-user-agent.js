// hard: P7
// source: https://github.com/facebookarchive/prepack/issues/24
// goal: navigator.userAgent sniffing at init is residual; RegExp.test on it is pure
// add at runtime:var navigator = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", language: "en-GB" };
var ua = navigator.userAgent;
var platform = {
  isMac: /Mac OS X/.test(ua),
  isWindows: /Windows/.test(ua),
  lang: navigator.language.split("-")[0],
};
var modKey = platform.isMac ? "Cmd" : "Ctrl";

inspect = function() {
  return JSON.stringify(platform) + modKey;
};
