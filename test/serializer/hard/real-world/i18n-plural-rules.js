// hard: real-world
// source: new (i18n tables selected by a runtime locale)
// goal: message tables built at init; the abstract runtime locale selects via switch; correct; no FatalError
var locale = global.__abstract ? __abstract("string", '("pl")') : "pl";
var messages = {
  en: { one: "{n} file", other: "{n} files" },
  pl: { one: "{n} plik", few: "{n} pliki", many: "{n} plików" },
};
function pluralCategory(loc, n) {
  switch (loc) {
    case "pl":
      if (n === 1) return "one";
      if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return "few";
      return "many";
    default:
      return n === 1 ? "one" : "other";
  }
}
var table = messages[locale] || messages.en;
function fmt(n) {
  return table[pluralCategory(locale, n)].replace("{n}", String(n));
}

inspect = function() {
  return [1, 2, 5, 22].map(fmt).join(", ");
};
