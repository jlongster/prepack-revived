// hard: serializer
// source: real-world-libs (marked@18.1.3 ES2015-lowered class _Lexer { static get rules() })
// goal: serialize ES2015 class getter/setter methods without FatalError PP0022 in ResidualHeapSerializer.serializeValue

var blockRules = { heading: /^#{1,6} / };
var inlineRules = { strong: /^\*\*([^*]+)\*\*/ };

class Lexer {
  static get rules() {
    return { block: blockRules, inline: inlineRules };
  }
  get mode() {
    return "gfm";
  }
}

global.Lexer = Lexer;

inspect = function() {
  var inst = new global.Lexer();
  return inst.mode + ":" + global.Lexer.rules.block.heading.test("## hi");
};
