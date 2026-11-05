const KEYWORDS = new Set(["let", "const", "if"]);
class Lexer {
  #pos = 0;
  constructor(src) { this.src = src; }
  #peek() { return this.src[this.#pos]; }
  static isKeyword(w) { return KEYWORDS.has(w); }
  word() {
    let w = "";
    while (this.#pos < this.src.length && /\w/.test(this.#peek())) w += this.src[this.#pos++];
    return w;
  }
  get position() { return this.#pos; }
}
globalThis.lex = (s) => {
  const l = new Lexer(s);
  const w = l.word();
  return (Lexer.isKeyword(w) ? "kw:" : "id:") + w + "@" + l.position;
};
