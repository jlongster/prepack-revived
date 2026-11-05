/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// The "extended" generator. Produces programs (as source text) covering loops
// with abstract trip counts (always fuel-bounded so the oracle terminates),
// break/continue/return/throw, labels, switch, try/catch/finally, objects and
// arrays, closures, calls to unknown functions passed as arguments, string
// operations and typeof/truthiness on mixed-type arguments.
//
// Everything is driven by a seeded PRNG, so a (seed) reproduces a program
// exactly. Programs never use Date, Math.random, or anything else that would
// make the oracle nondeterministic.

const { emitProgram } = require("./program");

function mulberry32(a) {
  return function() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUMBER_LITERALS = ["0", "1", "2", "3", "-1", "5", "0.5", "NaN", "-0", "10", "Infinity"];
const STRING_LITERALS = ['""', '"a"', '"0"', '"1"', '"ab"', '"x y"', '"10"', '"number"', '"string"'];
const ARG_ANY = [
  ...NUMBER_LITERALS,
  ...STRING_LITERALS,
  "true",
  "false",
  "true",
  "false",
  "null",
  "undefined",
  "null",
  "undefined",
  "[1, 2]",
  '{ a: 1, p0: "q" }',
];
// Feature names accepted by --disable.
const FEATURES = [
  "loops",
  "forin",
  "switch",
  "try",
  "throw",
  "labels",
  "closures",
  "helpers",
  "fnargs",
  "objects",
  "arrays",
  "update",
  "strings",
];
const PROPS = ["p0", "p1", "p2", "length", "a"];
const TYPEOFS = ['"number"', '"string"', '"boolean"', '"undefined"', '"object"', '"function"'];

class Generator {
  constructor(seed, options = {}) {
    this.random = mulberry32(seed);
    this.budget = options.size || 10 + this.int(50);
    this.disabled = new Set(options.disable || []);
    this.nextId = 1;
    this.helpers = [];
  }

  // 1 if the feature is enabled, else 0; multiply generator weights by it.
  on(feature) {
    return this.disabled.has(feature) ? 0 : 1;
  }
  int(n) {
    return Math.floor(this.random() * n);
  }
  chance(p) {
    return this.random() < p;
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
  weighted(choices) {
    const live = choices.filter(c => c[0] > 0);
    let total = live.reduce((a, c) => a + c[0], 0);
    let r = this.random() * total;
    for (const [w, f] of live) {
      if ((r -= w) < 0) return f();
    }
    return live[live.length - 1][1]();
  }
  id(prefix) {
    return prefix + this.nextId++;
  }

  // ---------------------------------------------------------------- program

  program() {
    const helperCount = this.on("helpers") ? this.int(3) : 0;
    for (let i = 0; i < helperCount; i++) this.helpers.push(this.helper());
    const anyParams = 1 + this.int(4);
    const fnParams = this.on("fnargs") && this.chance(0.35) ? 1 + this.int(2) : 0;
    const params = [];
    const kinds = [];
    for (let i = 0; i < anyParams + fnParams; i++) {
      params.push("a" + (i + 1));
      kinds.push(i < anyParams ? "any" : "fn");
    }
    const ctx = this.newFunctionCtx(
      params.filter((p, i) => kinds[i] === "any"),
      params.filter((p, i) => kinds[i] === "fn")
    );
    const body = this.block(ctx, 2 + this.int(6));
    body.push(this.finalReturn(ctx));
    const main = `function main(${params.join(", ")}) {\n${this.indent(body)}\n}`;
    const tupleCount = 3 + this.int(5);
    const tuples = [];
    for (let i = 0; i < tupleCount; i++) {
      tuples.push(kinds.map(k => (k === "any" ? this.pick(ARG_ANY) : `fns[${this.int(6)}]`)));
    }
    return emitProgram({ helpers: this.helpers, main, tuples });
  }

  helper() {
    const name = this.id("h");
    const arity = 1 + this.int(3);
    const params = [];
    for (let i = 0; i < arity; i++) params.push("p" + (i + 1));
    const ctx = this.newFunctionCtx(params, []);
    ctx.helpers = this.helperSigs();
    const body = this.block(ctx, 1 + this.int(4));
    body.push(`return ${this.expr(ctx, 2)};`);
    this.lastHelpers = (this.lastHelpers || []).concat([{ name, arity }]);
    return `function ${name}(${params.join(", ")}) {\n${this.indent(body)}\n}`;
  }

  helperSigs() {
    return (this.lastHelpers || []).slice();
  }

  newFunctionCtx(params, fnParams) {
    return {
      vars: params.slice(),
      counters: [],
      objs: [],
      arrs: [],
      fnParams,
      closures: [],
      helpers: this.helperSigs(),
      loopDepth: 0,
      breakable: false,
      continuable: false,
      labels: [],
      depth: 0,
    };
  }

  finalReturn(ctx) {
    const parts = [];
    const vars = ctx.vars.slice();
    const n = Math.min(vars.length, 1 + this.int(3));
    for (let i = 0; i < n; i++) parts.push(vars.splice(this.int(vars.length), 1)[0]);
    for (const o of ctx.objs.concat(ctx.arrs)) if (this.chance(0.7)) parts.push(o);
    if (parts.length === 1 && this.chance(0.5)) return `return ${parts[0]};`;
    return `return [${parts.join(", ")}];`;
  }

  // ---------------------------------------------------------------- statements

  block(ctx, n) {
    const out = [];
    for (let i = 0; i < n && this.budget > 0; i++) out.push(this.stmt(ctx));
    if (out.length === 0) out.push(this.simpleStmt(ctx));
    return out;
  }

  sub(ctx, overrides) {
    // Objects and arrays declared in a nested block may not have been initialized after it, so
    // they stay scoped to the block; scalars are function scoped (reading undefined is fine).
    return Object.assign({}, ctx, { depth: ctx.depth + 1, objs: ctx.objs.slice(), arrs: ctx.arrs.slice() }, overrides);
  }

  stmt(ctx) {
    this.budget--;
    const deep = ctx.depth >= 4;
    return this.weighted([
      [14, () => this.varDecl(ctx)],
      [10, () => this.assign(ctx)],
      [deep ? 0 : 12, () => this.ifStmt(ctx)],
      [deep || ctx.loopDepth >= 2 ? 0 : 9 * this.on("loops"), () => this.loop(ctx)],
      [deep ? 0 : 4 * this.on("switch"), () => this.switchStmt(ctx)],
      [deep ? 0 : 5 * this.on("try"), () => this.tryStmt(ctx)],
      [2 * this.on("throw"), () => this.throwStmt(ctx)],
      [3, () => `if (${this.cond(ctx)}) return ${this.expr(ctx, 2)};`],
      [ctx.breakable ? 4 : 0, () => `if (${this.cond(ctx)}) break;`],
      [ctx.continuable ? 3 : 0, () => `if (${this.cond(ctx)}) continue;`],
      [ctx.labels.length ? 3 : 0, () => this.labelJump(ctx)],
      [deep ? 0 : 2 * this.on("labels"), () => this.labeledBlock(ctx)],
      [ctx.objs.length ? 6 : 0, () => this.propWrite(ctx)],
      [ctx.arrs.length ? 4 : 0, () => this.arrayWrite(ctx)],
      [ctx.helpers.length || ctx.fnParams.length || ctx.closures.length ? 4 : 0, () => this.call(ctx) + ";"],
      [ctx.depth === 0 ? 2 * this.on("closures") : 0, () => this.closureDecl(ctx)],
    ]);
  }

  simpleStmt(ctx) {
    return this.assign(ctx);
  }

  varDecl(ctx) {
    return this.weighted([
      [
        6,
        () => {
          const e = this.expr(ctx, 3);
          const v = this.id("x");
          ctx.vars.push(v);
          return `var ${v} = ${e};`;
        },
      ],
      [
        2 * this.on("objects"),
        () => {
          const v = this.id("o");
          const props = [];
          const n = this.int(3);
          for (let i = 0; i < n; i++) props.push(`p${i}: ${this.expr(ctx, 2)}`);
          const init =
            ctx.objs.length && this.chance(0.2)
              ? `${this.cond(ctx)} ? ${this.pick(ctx.objs)} : { ${props.join(", ")} }`
              : `{ ${props.join(", ")} }`;
          ctx.objs.push(v);
          return `var ${v} = ${init};`;
        },
      ],
      [
        2 * this.on("arrays"),
        () => {
          const v = this.id("r");
          const elems = [];
          const n = this.int(3);
          for (let i = 0; i < n; i++) elems.push(this.expr(ctx, 2));
          ctx.arrs.push(v);
          return `var ${v} = [${elems.join(", ")}];`;
        },
      ],
    ]);
  }

  assign(ctx) {
    const v = this.pick(ctx.vars.filter(x => !ctx.counters.includes(x)));
    return this.weighted([
      [6, () => `${v} = ${this.expr(ctx, 3)};`],
      [2 * this.on("update"), () => `${v} += ${this.expr(ctx, 2)};`],
      [this.on("update"), () => `${v}++;`],
      [1, () => `${v} = ${v} ${this.pick(["-", "*", "%", "+"])} ${this.atom(ctx)};`],
    ]);
  }

  ifStmt(ctx) {
    const c = this.cond(ctx);
    const cons = this.block(this.sub(ctx), 1 + this.int(3));
    if (this.chance(0.5)) return `if (${c}) {\n${this.indent(cons)}\n}`;
    if (this.chance(0.2) && ctx.depth < 3)
      return `if (${c}) {\n${this.indent(cons)}\n} else ${this.ifStmt(this.sub(ctx))}`;
    const alt = this.block(this.sub(ctx), 1 + this.int(3));
    return `if (${c}) {\n${this.indent(cons)}\n} else {\n${this.indent(alt)}\n}`;
  }

  loop(ctx) {
    const i = this.id("i");
    const fuel = 2 + this.int(5);
    const label = this.chance(0.15) ? this.id("L") : undefined;
    const s = this.sub(ctx, {
      loopDepth: ctx.loopDepth + 1,
      breakable: true,
      continuable: true,
      labels: label ? ctx.labels.concat([{ name: label, loop: true }]) : ctx.labels,
    });
    const prefix = label ? `${label}: ` : "";
    return this.weighted([
      [
        4,
        () => {
          const bound = this.chance(0.7) ? this.pick(ctx.vars) : this.paren(this.expr(ctx, 2));
          ctx.vars.push(i);
          ctx.counters.push(i);
          s.vars = ctx.vars;
          const body = this.block(s, 1 + this.int(4));
          return `${prefix}for (var ${i} = 0; ${i} < ${bound} && ${i} < ${fuel}; ${i}++) {\n${this.indent(body)}\n}`;
        },
      ],
      [
        3,
        () => {
          const c = this.cond(ctx);
          ctx.counters.push(i);
          const body = this.block(s, 1 + this.int(4));
          ctx.vars.push(i);
          return `var ${i} = 0;\n${prefix}while (${c}) {\n  if (++${i} > ${fuel}) break;\n${this.indent(body)}\n}`;
        },
      ],
      [
        2,
        () => {
          ctx.counters.push(i);
          const body = this.block(s, 1 + this.int(4));
          const c = this.paren(this.cond(ctx));
          ctx.vars.push(i);
          return `var ${i} = 0;\n${prefix}do {\n${this.indent(body)}\n} while (${c} && ++${i} < ${fuel});`;
        },
      ],
      [
        2,
        () => {
          // Count down from an abstract start; NaN, strings and Infinity terminate immediately.
          const start = this.pick(ctx.vars);
          ctx.vars.push(i);
          ctx.counters.push(i);
          const body = this.block(s, 1 + this.int(3));
          return `${prefix}for (var ${i} = ${start}; ${i} > 0 && ${i} < ${fuel + 4}; ${i}--) {\n${this.indent(
            body
          )}\n}`;
        },
      ],
      [
        ctx.objs.length ? this.on("forin") : 0,
        () => {
          // Adding properties during for-in enumeration is implementation defined, so the body
          // gets no access to objects or closures that could add any.
          const k = this.id("k");
          const o = this.pick(ctx.objs);
          ctx.vars.push(k);
          s.objs = [];
          s.closures = [];
          s.helpers = [];
          s.fnParams = [];
          const body = this.block(s, 1 + this.int(3));
          return `${prefix}for (var ${k} in ${o}) {\n${this.indent(body)}\n}`;
        },
      ],
    ]);
  }

  switchStmt(ctx) {
    const d = this.expr(ctx, 2);
    const s = this.sub(ctx, { breakable: true });
    const n = 1 + this.int(3);
    const cases = [];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      let lit = this.literal();
      if (used.has(lit)) continue;
      used.add(lit);
      const body = this.block(s, this.int(3));
      if (this.chance(0.7)) body.push("break;");
      cases.push(`case ${lit}:\n${this.indent(body)}`);
    }
    if (this.chance(0.6))
      cases.splice(this.int(cases.length + 1), 0, `default:\n${this.indent(this.block(s, 1 + this.int(2)))}`);
    return `switch (${d}) {\n${this.indent(cases)}\n}`;
  }

  tryStmt(ctx) {
    const s = this.sub(ctx);
    const body = this.block(s, 1 + this.int(4));
    const kind = this.int(3);
    let out = `try {\n${this.indent(body)}\n}`;
    if (kind !== 1) {
      const e = this.id("e");
      const cs = this.sub(ctx, { vars: ctx.vars.concat([e]) });
      // The catch parameter is block scoped; keep it out of the function's var list.
      const handler = this.block(cs, 1 + this.int(3));
      for (const v of cs.vars) if (v !== e && !ctx.vars.includes(v)) ctx.vars.push(v);
      out += ` catch (${e}) {\n${this.indent(handler)}\n}`;
    }
    if (kind !== 0) {
      const fs = this.sub(ctx);
      out += ` finally {\n${this.indent(this.block(fs, 1 + this.int(2)))}\n}`;
    }
    return out;
  }

  throwStmt(ctx) {
    const value = this.chance(0.6) ? `new Error("E${this.int(5)}")` : this.expr(ctx, 1);
    if (this.chance(0.8)) return `if (${this.cond(ctx)}) throw ${value};`;
    return `throw ${value};`;
  }

  labelJump(ctx) {
    const l = this.pick(ctx.labels);
    if (l.loop && ctx.continuable && this.chance(0.4)) return `if (${this.cond(ctx)}) continue ${l.name};`;
    return `if (${this.cond(ctx)}) break ${l.name};`;
  }

  labeledBlock(ctx) {
    const label = this.id("B");
    const s = this.sub(ctx, { labels: ctx.labels.concat([{ name: label, loop: false }]) });
    const body = this.block(s, 1 + this.int(2));
    body.splice(this.int(body.length + 1), 0, `if (${this.cond(ctx)}) break ${label};`);
    body.push(...this.block(s, 1));
    return `${label}: {\n${this.indent(body)}\n}`;
  }

  propWrite(ctx) {
    const o = this.pick(ctx.objs);
    return this.weighted([
      [6, () => `${o}.${this.pick(PROPS.slice(0, 3))} = ${this.expr(ctx, 2)};`],
      [
        2,
        () =>
          `${o}[${this.chance(0.5) ? this.pick(ctx.vars) : this.pick(['"p0"', '"p1"', "0"])}] = ${this.expr(ctx, 2)};`,
      ],
      [1, () => `delete ${o}.${this.pick(PROPS.slice(0, 3))};`],
      [2, () => `${o}.${this.pick(PROPS.slice(0, 3))} += ${this.expr(ctx, 1)};`],
    ]);
  }

  arrayWrite(ctx) {
    const r = this.pick(ctx.arrs);
    return this.weighted([
      [5, () => `${r}.push(${this.expr(ctx, 2)});`],
      [2, () => `${r}[${this.pick(["0", "1", "2", r + ".length"])}] = ${this.expr(ctx, 2)};`],
      [1, () => `${r}.pop();`],
      [1, () => `${r}[${this.pick(ctx.vars)}] = ${this.expr(ctx, 1)};`],
    ]);
  }

  closureDecl(ctx) {
    const name = this.id("g");
    const p = this.id("q");
    const s = this.sub(ctx, {
      vars: ctx.vars.concat([p]),
      loopDepth: 0,
      breakable: false,
      continuable: false,
      labels: [],
      closures: ctx.closures.slice(),
      depth: 2,
    });
    const body = this.block(s, 1 + this.int(3));
    body.push(`return ${this.expr(s, 2)};`);
    // Variables declared inside the closure are local to it.
    ctx.closures.push(name);
    return `var ${name} = function (${p}) {\n${this.indent(body)}\n};`;
  }

  // ---------------------------------------------------------------- expressions

  literal() {
    return this.weighted([
      [3, () => this.pick(NUMBER_LITERALS)],
      [3, () => this.pick(STRING_LITERALS)],
      [2, () => this.pick(["true", "false"])],
      [1, () => this.pick(["null", "undefined"])],
    ]);
  }

  atom(ctx) {
    return this.weighted([
      [3, () => this.literal()],
      [8, () => this.pick(ctx.vars)],
      [ctx.objs.length ? 2 : 0, () => `${this.pick(ctx.objs)}.${this.pick(PROPS)}`],
      [ctx.arrs.length ? 1 : 0, () => `${this.pick(ctx.arrs)}[${this.pick(["0", "1", ...ctx.vars.slice(0, 3)])}]`],
      [ctx.arrs.length ? 1 : 0, () => `${this.pick(ctx.arrs)}.length`],
    ]);
  }

  cond(ctx) {
    return this.weighted([
      [5, () => this.pick(ctx.vars)],
      [2, () => `!${this.pick(ctx.vars)}`],
      [3, () => `typeof ${this.pick(ctx.vars)} === ${this.pick(TYPEOFS)}`],
      [3, () => `${this.atom(ctx)} ${this.pick(["<", ">", "<=", ">=", "===", "!==", "==", "!="])} ${this.atom(ctx)}`],
      [1, () => `${this.pick(ctx.vars)} == null`],
      [2, () => `${this.atom(ctx)} ${this.pick(["&&", "||"])} ${this.atom(ctx)}`],
      [2, () => this.expr(ctx, 2)],
    ]);
  }

  expr(ctx, depth) {
    if (depth <= 0) return this.atom(ctx);
    const d = depth - 1;
    const callable = ctx.helpers.length || ctx.fnParams.length || ctx.closures.length;
    return this.weighted([
      [6, () => this.atom(ctx)],
      [4, () => `${this.expr(ctx, d)} ${this.pick(["+", "-", "*", "%", "+", "+"])} ${this.expr(ctx, d)}`],
      [3, () => `${this.expr(ctx, d)} ${this.pick(["<", ">", "===", "!==", "==", "<="])} ${this.expr(ctx, d)}`],
      [3, () => `${this.expr(ctx, d)} ${this.pick(["&&", "||"])} ${this.expr(ctx, d)}`],
      [3, () => `${this.cond(ctx)} ? ${this.expr(ctx, d)} : ${this.expr(ctx, d)}`],
      [2, () => `${this.pick(["!", "typeof ", "-", "+", "!!"])}${this.paren(this.expr(ctx, d))}`],
      [2, () => `typeof ${this.pick(ctx.vars)} === ${this.pick(TYPEOFS)}`],
      [3 * this.on("strings"), () => this.stringOp(ctx, d)],
      [2, () => `${this.pick(["String", "Number", "Boolean", "isNaN", "parseInt", "Math.abs"])}(${this.expr(ctx, d)})`],
      [1, () => `Math.${this.pick(["max", "min"])}(${this.expr(ctx, d)}, ${this.expr(ctx, d)})`],
      [callable ? 3 : 0, () => this.call(ctx, d)],
      [1, () => `{ p0: ${this.expr(ctx, d)} }.p0`.replace(/^/, "(") + ")"],
      [1, () => `[${this.expr(ctx, d)}, ${this.expr(ctx, d)}][${this.pick(["0", "1", "2"])}]`],
      [ctx.objs.length ? 1 : 0, () => `${this.pick(['"p0"', '"p1"', '"a"'])} in ${this.pick(ctx.objs)}`],
      [
        ctx.arrs.length ? 1 : 0,
        () => `${this.pick(ctx.arrs)}.${this.pick(['join(",")', "indexOf(" + this.atom(ctx) + ")", "length"])}`,
      ],
      [0.3, () => `${this.pick(ctx.vars)}.${this.pick(["length", "a", "p0"])}`],
    ]);
  }

  stringOp(ctx, d) {
    const s = this.chance(0.5) ? `String(${this.expr(ctx, d)})` : `("" + ${this.expr(ctx, d)})`;
    return this.weighted([
      [3, () => `${s}.length`],
      [2, () => `${s}.charAt(${this.pick(["0", "1"])})`],
      [2, () => `${s}.indexOf(${this.pick(STRING_LITERALS)})`],
      [1, () => `${s}.slice(${this.pick(["0", "1", "-1"])})`],
      [1, () => `${s}.toUpperCase()`],
      [1, () => `${s} + ${this.pick(STRING_LITERALS)}`],
      [1, () => `${s}.split(${this.pick(['""', '"a"', '" "'])}).length`],
    ]);
  }

  call(ctx, d = 1) {
    const choices = [];
    for (const h of ctx.helpers) choices.push([h.name, h.arity]);
    for (const f of ctx.fnParams) choices.push([f, 1 + this.int(2)]);
    for (const c of ctx.closures) choices.push([c, 1]);
    const [name, arity] = this.pick(choices);
    const args = [];
    for (let i = 0; i < arity; i++) {
      args.push(ctx.objs.length && this.chance(0.2) ? this.pick(ctx.objs) : this.expr(ctx, Math.max(0, d - 1)));
    }
    return `${name}(${args.join(", ")})`;
  }

  paren(e) {
    return /^[\w$.]+$/.test(e) ? e : `(${e})`;
  }

  indent(lines) {
    return (Array.isArray(lines) ? lines : [lines])
      .join("\n")
      .split("\n")
      .map(l => (l.length ? "  " + l : l))
      .join("\n");
  }
}

function generateExtended(seed, options) {
  return new Generator(seed, options).program();
}

module.exports = { generateExtended, mulberry32, FEATURES };
