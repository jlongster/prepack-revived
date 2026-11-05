"use strict";

const fs = require("fs");
const path = require("path");

function readPkgFile(nmDir, relPath) {
  return fs.readFileSync(path.join(nmDir, relPath), "utf8");
}

const ROOT_EXPR =
  '(typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : this)';

const SPECS = [
  {
    id: "lodash",
    name: "Lodash",
    kind: "library",
    buildType: "umd",
    packages: ["lodash"],
    description:
      "Utility library; module init constructs LodashWrapper/LazyWrapper prototypes, 300+ methods, and lookup tables.",
    build(nmDir) {
      return readPkgFile(nmDir, "lodash/lodash.js");
    },
    smokeCode: `(function(root) {
      var _ = root._;
      var users = [
        { user: "fred", dept: "eng", score: 48 },
        { user: "barney", dept: "ops", score: 36 },
        { user: "pebbles", dept: "eng", score: 52 },
        { user: "wilma", dept: "ops", score: 44 }
      ];
      var grouped = _.mapValues(_.groupBy(users, "dept"), function(list) {
        return _.map(_.orderBy(list, ["score"], ["desc"]), "user");
      });
      var merged = _.merge({ a: { x: 1, arr: [1, 2] } }, { a: { y: 2, arr: [3] } });
      var chained = _([1, 2, 3, 4, 5, 6])
        .filter(function(n) { return n % 2 === 0; })
        .map(function(n) { return n * n; })
        .sum();
      var compiled = _.template("Hello <%= name %> (<%- tag %>)");
      return JSON.stringify({
        version: _.VERSION,
        chunk: _.chunk(["a", "b", "c", "d", "e"], 2),
        camel: _.camelCase("--foo-bar_baz--"),
        kebab: _.kebabCase("FooBarBaz"),
        uniq: _.uniqBy([2.1, 1.2, 2.3], Math.floor),
        grouped: grouped,
        merged: merged,
        chained: chained,
        tpl: compiled({ name: "Ada", tag: "<admin>" })
      });
    })`,
  },

  {
    id: "underscore",
    name: "Underscore",
    kind: "library",
    buildType: "umd",
    packages: ["underscore"],
    description:
      "Functional utility library; module init performs environment feature checks and mixes 100+ functions onto `_.prototype`.",
    build(nmDir) {
      return readPkgFile(nmDir, "underscore/underscore-umd.js");
    },
    smokeCode: `(function(root) {
      var _ = root._;
      var items = [
        { k: "a", v: 10 },
        { k: "b", v: 25 },
        { k: "a", v: 15 },
        { k: "c", v: 5 }
      ];
      var byKey = _.groupBy(items, "k");
      var sums = _.mapObject(byKey, function(arr) {
        return _.reduce(arr, function(acc, x) { return acc + x.v; }, 0);
      });
      var tpl = _.template("item:<%= id %>:<%- raw %>");
      return JSON.stringify({
        version: _.VERSION,
        sums: sums,
        sorted: _.pluck(_.sortBy(items, "v"), "v"),
        zip: _.zip(["x", "y"], [1, 2], [true, false]),
        flatten: _.flatten([1, [2, [3, [4]]]]),
        chain: _.chain([1, 2, 3, 4, 5]).filter(function(n) { return n > 2; }).map(function(n) { return n * 3; }).value(),
        tpl: tpl({ id: 7, raw: "<b>ok</b>" })
      });
    })`,
  },

  {
    id: "ramda",
    name: "Ramda",
    kind: "library",
    buildType: "umd",
    packages: ["ramda"],
    description:
      "Point-free curried functional library; module init wraps 250+ combinators in _curry1/_curry2/_curry3 dispatchers.",
    build(nmDir) {
      return readPkgFile(nmDir, "ramda/dist/ramda.js");
    },
    smokeCode: `(function(root) {
      var R = root.R;
      var transform = R.pipe(
        R.filter(R.propSatisfies(R.gt(R.__, 20), "age")),
        R.sortBy(R.prop("name")),
        R.map(R.evolve({ age: R.inc, name: R.toUpper }))
      );
      var data = [
        { name: "charlie", age: 25 },
        { name: "alice", age: 19 },
        { name: "bob", age: 31 }
      ];
      var xLens = R.lensPath(["coords", "x"]);
      return JSON.stringify({
        transformed: transform(data),
        lensed: R.over(xLens, R.multiply(10), { coords: { x: 4, y: 9 } }),
        grouped: R.groupBy(function(n) { return n % 2 === 0 ? "even" : "odd"; }, [1, 2, 3, 4, 5]),
        zipObj: R.zipObj(["a", "b", "c"], [10, 20, 30]),
        unnest: R.unnest([[1, 2], [3, [4]], [5]])
      });
    })`,
  },

  {
    id: "immutable",
    name: "Immutable.js",
    kind: "library",
    buildType: "umd",
    packages: ["immutable"],
    description:
      "Persistent HAMT/trie collections (Map, List, Set, OrderedMap, Record); builds prototype hierarchies and sentinels at init.",
    build(nmDir) {
      return readPkgFile(nmDir, "immutable/dist/immutable.js");
    },
    smokeCode: `(function(root) {
      var I = root.Immutable;
      var m1 = I.Map({ a: 1, b: 2, c: 3 });
      var m2 = m1.set("b", 20).set("d", 4);
      var m3 = I.Map({ a: 1, b: 20, c: 3, d: 4 });
      var list = I.List.of(10, 20, 30).push(40).unshift(5).filter(function(x) { return x >= 10; });
      var nested = I.fromJS({ user: { roles: ["viewer", "editor"], count: 2 } });
      var nested2 = nested.updateIn(["user", "roles"], function(r) { return r.push("admin"); });
      var Point = I.Record({ x: 0, y: 0 });
      var p = new Point({ x: 7, y: 9 });
      return JSON.stringify({
        m1b: m1.get("b"),
        m2b: m2.get("b"),
        equal: I.is(m2, m3),
        sameHash: m2.hashCode() === m3.hashCode(),
        list: list.toArray(),
        nestedOrig: nested.toJS(),
        nestedNext: nested2.toJS(),
        orderedKeys: I.OrderedMap([["z", 1], ["a", 2], ["m", 3]]).keySeq().toArray(),
        point: [p.x, p.y]
      });
    })`,
  },

  {
    id: "moment",
    name: "Moment.js (with locales)",
    kind: "library",
    buildType: "umd",
    packages: ["moment"],
    description:
      "Init-heavy date/time library with 135+ bundled locales registered via defineLocale() and regex token tables built at load.",
    build(nmDir) {
      return readPkgFile(nmDir, "moment/min/moment-with-locales.js");
    },
    smokeCode: `(function(root) {
      var moment = root.moment;
      var base = moment.utc("2026-03-15T14:25:00Z");
      var shifted = base.clone().add(10, "days").subtract(3, "hours");
      var dur = moment.duration({ hours: 50, minutes: 15 });
      return JSON.stringify({
        version: moment.version,
        localeCount: moment.locales().length,
        iso: shifted.toISOString(),
        en: base.clone().locale("en").format("dddd, MMMM Do YYYY, HH:mm"),
        fr: base.clone().locale("fr").format("dddd D MMMM YYYY HH:mm"),
        de: base.clone().locale("de").format("dddd, D. MMMM YYYY HH:mm"),
        ja: base.clone().locale("ja").format("YYYY年M月D日(ddd) HH:mm"),
        diffHours: shifted.diff(base, "hours"),
        durMinutes: dur.asMinutes(),
        leap2024: moment.utc([2024]).isLeapYear(),
        leap2026: moment.utc([2026]).isLeapYear()
      });
    })`,
  },

  {
    id: "chroma-js",
    name: "chroma.js",
    kind: "library",
    buildType: "umd",
    packages: ["chroma-js"],
    description:
      "Color conversion & scale library; module init registers RGB/HSL/Lab/LCH/CMYK color spaces, ColorBrewer palettes, and W3C named colors.",
    build(nmDir) {
      return readPkgFile(nmDir, "chroma-js/chroma.js");
    },
    smokeCode: `(function(root) {
      var chroma = root.chroma;
      var scale = chroma.scale(["#fafa6e", "#2A4858"]).mode("lch").colors(5);
      var bez = chroma.bezier(["yellow", "red", "black"]).scale().colors(4);
      var c = chroma("#336699");
      return JSON.stringify({
        version: chroma.version,
        scale: scale,
        bezier: bez,
        lab: c.lab().map(function(v) { return Math.round(v * 100) / 100; }),
        luminance: Math.round(c.luminance() * 10000) / 10000,
        contrast: Math.round(chroma.contrast("#ffffff", "#336699") * 100) / 100,
        mix: chroma.mix("red", "blue", 0.5, "lab").hex()
      });
    })`,
  },

  {
    id: "acorn",
    name: "Acorn",
    kind: "library",
    buildType: "umd",
    packages: ["acorn"],
    description:
      "ECMAScript parser; module init builds token types, keyword regexes, operator precedence tables, and Unicode identifier bitmaps.",
    build(nmDir) {
      return readPkgFile(nmDir, "acorn/dist/acorn.js");
    },
    smokeCode: `(function(root) {
      var acorn = root.acorn;
      var sample = [
        "const add = (a, b = 1) => a + b;",
        "class Counter { constructor(n) { this.n = n; } inc() { return ++this.n; } }",
        "export function calc(xs) { let s = 0; for (const x of xs) s += add(x); return s; }"
      ].join("\\n");
      var ast = acorn.parse(sample, { ecmaVersion: 2022, sourceType: "module", locations: true });
      var tokCount = 0;
      var iter = acorn.tokenizer(sample, { ecmaVersion: 2022, sourceType: "module" });
      while (iter.getToken().type !== acorn.tokTypes.eof) tokCount++;
      return JSON.stringify({
        version: acorn.version,
        topTypes: ast.body.map(function(n) { return n.type; }),
        classMethods: ast.body[1].body.body.map(function(m) { return m.key.name + ":" + m.kind; }),
        endLine: ast.loc.end.line,
        tokCount: tokCount
      });
    })`,
  },

  {
    id: "crc-32",
    name: "SheetJS crc-32",
    kind: "library",
    buildType: "umd",
    packages: ["crc-32"],
    description:
      "Lookup-table CRC-32 implementation; module init computes a 256-entry table and 16 slice-by-16 Int32Array subtables (4,096 entries).",
    build(nmDir) {
      return (
        readPkgFile(nmDir, "crc-32/crc32.js") +
        `\n;if (typeof CRC32 !== "undefined") ${ROOT_EXPR}.CRC32 = CRC32;\n`
      );
    },
    smokeCode: `(function(root) {
      var CRC32 = root.CRC32;
      return JSON.stringify({
        version: CRC32.version,
        str: CRC32.str("The quick brown fox jumps over the lazy dog"),
        utf8: CRC32.str("Prepack λ partial evaluation"),
        bstr: CRC32.bstr("123456789"),
        buf: CRC32.buf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
        seeded: CRC32.str("world", CRC32.str("hello "))
      });
    })`,
  },

  {
    id: "marked",
    name: "Marked",
    kind: "library",
    buildType: "umd",
    packages: ["marked"],
    description:
      "Markdown parser & compiler; module init constructs GFM/pedantic/normal block and inline grammar regex tables.",
    build(nmDir) {
      return readPkgFile(nmDir, "marked/lib/marked.umd.js");
    },
    smokeCode: `(function(root) {
      var marked = root.marked;
      var md = [
        "# Heading 1",
        "",
        "Paragraph with **bold**, *italic*, and \`code\`.",
        "",
        "- item one",
        "- item two",
        "",
        "| col A | col B |",
        "| --- | --- |",
        "| 1 | 2 |"
      ].join("\\n");
      var tokens = marked.lexer(md);
      var html = marked.parse(md);
      return JSON.stringify({
        tokenTypes: tokens.map(function(t) { return t.type; }),
        htmlLen: html.length,
        hasTable: html.indexOf("<table>") >= 0,
        hasStrong: html.indexOf("<strong>bold</strong>") >= 0
      });
    })`,
  },

  {
    id: "d3-scale",
    name: "D3 Scale + Array",
    kind: "library",
    buildType: "umd",
    packages: ["d3-scale", "d3-array", "d3-interpolate", "d3-color", "d3-format", "d3-time", "d3-time-format", "internmap"],
    description:
      "Data visualization quantitative/ordinal/time scales, array statistics, formatters, and color interpolators initialized on `d3`.",
    build(nmDir) {
      const files = [
        "internmap/dist/internmap.js",
        "d3-array/dist/d3-array.js",
        "d3-color/dist/d3-color.js",
        "d3-interpolate/dist/d3-interpolate.js",
        "d3-format/dist/d3-format.js",
        "d3-time/dist/d3-time.js",
        "d3-time-format/dist/d3-time-format.js",
        "d3-scale/dist/d3-scale.js",
      ];
      return files.map(f => readPkgFile(nmDir, f)).join("\n;\n");
    },
    smokeCode: `(function(root) {
      var d3 = root.d3;
      var lin = d3.scaleLinear().domain([0, 100]).range([0, 500]);
      var band = d3.scaleBand().domain(["Q1", "Q2", "Q3", "Q4"]).range([0, 400]).paddingInner(0.2);
      var color = d3.scaleLinear().domain([0, 1]).range(["#ff0000", "#0000ff"]);
      var fmt = d3.format(".2s");
      return JSON.stringify({
        lin25: lin(25),
        invert250: lin.invert(250),
        ticks: lin.ticks(5),
        bandQ2: Math.round(band("Q2") * 100) / 100,
        bandwidth: Math.round(band.bandwidth() * 100) / 100,
        colorMid: color(0.5),
        extent: d3.extent([14, -3, 42, 8, 29]),
        quantile: d3.quantile([10, 20, 30, 40, 50], 0.5),
        formatted: fmt(42000000)
      });
    })`,
  },

  {
    id: "redux",
    name: "Redux (store + middleware init)",
    kind: "app-workload",
    buildType: "esbuild-iife",
    packages: ["redux"],
    description:
      "Redux bundled into an ES2015 IIFE; module init composes reducers, applies logging/validation middleware, creates a store, and dispatches seed actions.",
    build(nmDir, esbuild) {
      const entry = `
        import { createStore, combineReducers, applyMiddleware, compose } from "redux";
        function todosReducer(state, action) {
          if (state === undefined) state = [];
          if (action.type === "ADD_TODO") {
            return state.concat([{ id: state.length + 1, text: action.text, done: false }]);
          }
          if (action.type === "TOGGLE_TODO") {
            return state.map(function(t) {
              return t.id === action.id ? { id: t.id, text: t.text, done: !t.done } : t;
            });
          }
          return state;
        }
        function statsReducer(state, action) {
          if (state === undefined) state = { dispatches: 0, lastType: "NONE" };
          return { dispatches: state.dispatches + 1, lastType: action.type };
        }
        var rootReducer = combineReducers({ todos: todosReducer, stats: statsReducer });
        var auditMiddleware = function(storeApi) {
          return function(next) {
            return function(action) {
              if (action && typeof action.text === "string") {
                action = { type: action.type, text: action.text.trim(), id: action.id };
              }
              return next(action);
            };
          };
        };
        var bootStore = createStore(rootReducer, compose(applyMiddleware(auditMiddleware)));
        bootStore.dispatch({ type: "ADD_TODO", text: "  build corpus  " });
        bootStore.dispatch({ type: "ADD_TODO", text: "measure startup" });
        bootStore.dispatch({ type: "TOGGLE_TODO", id: 1 });
        var root = ${ROOT_EXPR};
        root.ReduxBench = {
          bootSnapshot: bootStore.getState(),
          runScenario: function(extraTexts) {
            var s = createStore(rootReducer, applyMiddleware(auditMiddleware));
            for (var i = 0; i < extraTexts.length; i++) {
              s.dispatch({ type: "ADD_TODO", text: extraTexts[i] });
            }
            s.dispatch({ type: "TOGGLE_TODO", id: 2 });
            return s.getState();
          }
        };
      `;
      const res = esbuild.buildSync({
        stdin: { contents: entry, resolveDir: path.dirname(nmDir) },
        bundle: true,
        format: "iife",
        target: "es2015",
        write: false,
      });
      return res.outputFiles[0].text;
    },
    smokeCode: `(function(root) {
      var rb = root.ReduxBench;
      var next = rb.runScenario(["  alpha ", "beta", "gamma"]);
      return JSON.stringify({
        bootTodos: rb.bootSnapshot.todos,
        bootLast: rb.bootSnapshot.stats.lastType,
        nextTodos: next.todos,
        nextLast: next.stats.lastType
      });
    })`,
  },

  {
    id: "handlebars-app",
    name: "Handlebars (init template compile)",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["handlebars"],
    description:
      "App workload: loads Handlebars compiler+runtime, registers helpers/partials, compiles an invoice template AST to JS, and renders a boot view at module init.",
    build(nmDir) {
      const hb = readPkgFile(nmDir, "handlebars/dist/handlebars.js");
      const appInit = `
;(function(root) {
  var Handlebars = root.Handlebars;
  Handlebars.registerHelper("currency", function(n) {
    return "$" + Number(n).toFixed(2);
  });
  Handlebars.registerHelper("upper", function(s) {
    return String(s).toUpperCase();
  });
  Handlebars.registerPartial("lineItem", "<li>{{upper sku}}: {{qty}} x {{currency unitPrice}}</li>");
  var templateSrc = [
    "<section class=\\"invoice\\" data-id=\\"{{invoiceId}}\\">",
    "  <h1>Invoice for {{customer}}</h1>",
    "  <ul>{{#each lines}}{{> lineItem}}{{/each}}</ul>",
    "  {{#if paid}}<p class=\\"paid\\">PAID</p>{{else}}<p class=\\"due\\">DUE {{currency total}}</p>{{/if}}",
    "</section>"
  ].join("\\n");
  var compiledInvoice = Handlebars.compile(templateSrc);
  var bootHtml = compiledInvoice({
    invoiceId: "INV-100",
    customer: "Acme Corp",
    paid: false,
    total: 319.5,
    lines: [
      { sku: "kb-01", qty: 2, unitPrice: 89.75 },
      { sku: "ms-02", qty: 1, unitPrice: 140.0 }
    ]
  });
  root.HandlebarsApp = {
    bootHtml: bootHtml,
    renderInvoice: compiledInvoice
  };
})(${ROOT_EXPR});
`;
      return hb + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.HandlebarsApp;
      var dyn = app.renderInvoice({
        invoiceId: "INV-205",
        customer: "Globex",
        paid: true,
        total: 50,
        lines: [{ sku: "adp-9", qty: 2, unitPrice: 25 }]
      });
      return JSON.stringify({
        bootHtml: app.bootHtml,
        dynHtml: dyn
      });
    })`,
  },

  {
    id: "preact-ssr-app",
    name: "Preact SSR App (init + runtime renderToString)",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["preact", "preact-render-to-string"],
    description:
      "App workload: Preact + preact-render-to-string renders a multi-component documentation dashboard at module init and exposes dynamic SSR at runtime.",
    build(nmDir) {
      const preact = readPkgFile(nmDir, "preact/dist/preact.min.umd.js");
      const prts = readPkgFile(nmDir, "preact-render-to-string/dist/index.umd.js");
      const appInit = `
;(function(root) {
  var h = root.preact.h;
  var renderToString = root.preactRenderToString.renderToString;
  function Nav(props) {
    return h("nav", { class: "top-nav" }, props.links.map(function(l) {
      return h("a", { key: l.href, href: l.href, class: l.active ? "is-active" : "" }, l.label);
    }));
  }
  function MetricCard(props) {
    return h("article", { class: "metric metric-" + props.trend },
      h("h3", null, props.name),
      h("strong", null, String(props.value) + props.unit),
      h("span", null, "tags:" + props.tags.join(","))
    );
  }
  function Dashboard(props) {
    return h("main", { id: "dashboard", "data-env": props.env },
      h(Nav, { links: props.links }),
      h("section", { class: "grid" }, props.metrics.map(function(m) {
        return h(MetricCard, Object.assign({ key: m.name }, m));
      }))
    );
  }
  var bootHtml = renderToString(h(Dashboard, {
    env: "prod",
    links: [
      { href: "/", label: "Overview", active: true },
      { href: "/traces", label: "Traces", active: false },
      { href: "/alerts", label: "Alerts", active: false }
    ],
    metrics: [
      { name: "Cold Start", value: 14.2, unit: "ms", trend: "down", tags: ["v8", "init"] },
      { name: "Bundle Gzip", value: 42, unit: "KB", trend: "flat", tags: ["size"] },
      { name: "Throughput", value: 1280, unit: "rps", trend: "up", tags: ["http", "ssr"] }
    ]
  }));
  root.PreactSSRApp = {
    bootHtml: bootHtml,
    renderDashboard: function(env, metrics) {
      return renderToString(h(Dashboard, {
        env: env,
        links: [{ href: "/" + env, label: env.toUpperCase(), active: true }],
        metrics: metrics
      }));
    }
  };
})(${ROOT_EXPR});
`;
      return preact + "\n;\n" + prts + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.PreactSSRApp;
      var dyn = app.renderDashboard("staging", [
        { name: "Latency", value: 9.5, unit: "ms", trend: "down", tags: ["p50"] }
      ]);
      return JSON.stringify({
        bootHtml: app.bootHtml,
        dynHtml: dyn
      });
    })`,
  },

  {
    id: "react-ssr-app",
    name: "React 18 SSR App (init + runtime renderToString)",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["react", "react-dom"],
    description:
      "App workload: React 18 + ReactDOMServer legacy browser bundle renders a multi-component storefront catalog at module init and serves runtime SSR.",
    build(nmDir) {
      const react = readPkgFile(nmDir, "react/umd/react.production.min.js");
      const rds = readPkgFile(nmDir, "react-dom/umd/react-dom-server-legacy.browser.production.min.js");
      const appInit = `
;(function(root) {
  var h = root.React.createElement;
  var renderToString = root.ReactDOMServer.renderToString;
  var CurrencyCtx = root.React.createContext("USD");
  function StatusPill(props) {
    return h("span", { className: "pill pill-" + (props.inStock ? "ok" : "wait") },
      props.inStock ? "In Stock" : "Backorder"
    );
  }
  function ProductRow(props) {
    return h(CurrencyCtx.Consumer, null, function(ccy) {
      return h("tr", null,
        h("td", null, props.item.sku),
        h("td", null, props.item.title),
        h("td", null, ccy + " " + props.item.price.toFixed(2)),
        h("td", null, h(StatusPill, { inStock: props.item.inStock }))
      );
    });
  }
  function Storefront(props) {
    var total = props.items.reduce(function(acc, it) { return acc + it.price; }, 0);
    var availableCount = props.items.filter(function(it) { return it.inStock; }).length;
    return h(CurrencyCtx.Provider, { value: props.currency },
      h("div", { id: "storefront", "data-region": props.region },
        h("header", null, h("h1", null, props.heading), h("p", null, availableCount + " ready to ship")),
        h("table", null,
          h("tbody", null, props.items.map(function(it) {
            return h(ProductRow, { key: it.sku, item: it });
          }))
        ),
        h("footer", null, "Subtotal (" + props.currency + "): " + total.toFixed(2))
      )
    );
  }
  var bootItems = [
    { sku: "KB-87", title: "Mechanical Keyboard", price: 119.0, inStock: true },
    { sku: "MN-27", title: "27in 4K Display", price: 349.5, inStock: false },
    { sku: "MS-03", title: "Wireless Trackball", price: 54.25, inStock: true },
    { sku: "DK-12", title: "Thunderbolt Dock", price: 189.0, inStock: true }
  ];
  var bootHtml = renderToString(h(Storefront, {
    region: "us-east",
    currency: "USD",
    heading: "Hardware Catalog",
    items: bootItems
  }));
  root.ReactSSRApp = {
    bootHtml: bootHtml,
    renderCatalog: function(region, currency, heading, items) {
      return renderToString(h(Storefront, {
        region: region,
        currency: currency,
        heading: heading,
        items: items
      }));
    }
  };
})(${ROOT_EXPR});
`;
      return react + "\n;\n" + rds + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.ReactSSRApp;
      var dyn = app.renderCatalog("eu-west", "EUR", "Accessories", [
        { sku: "CB-01", title: "Braided USB-C Cable", price: 14.5, inStock: true },
        { sku: "ST-04", title: "Aluminum Stand", price: 42.0, inStock: false }
      ]);
      return JSON.stringify({
        bootHtml: app.bootHtml,
        dynHtml: dyn
      });
    })`,
  },

  {
    id: "yaml-router-app",
    name: "YAML Config + Mustache + Router App",
    kind: "app-workload",
    buildType: "umd+app-init",
    packages: ["js-yaml", "mustache"],
    description:
      "Init-heavy app workload: parses a 95-line YAML service/route manifest with js-yaml, compiles 10 parameterized REST routes into RegExps, and pre-parses Mustache views at module init.",
    build(nmDir) {
      const yaml = readPkgFile(nmDir, "js-yaml/dist/js-yaml.js");
      const mustache = readPkgFile(nmDir, "mustache/mustache.js");
      const appInit = `
;(function(root) {
  var jsyaml = root.jsyaml;
  var Mustache = root.Mustache;
  var manifestYaml = [
    "service:",
    "  name: edge-gateway",
    "  version: 2.4.0",
    "  defaults:",
    "    cacheTtl: 120",
    "    rateLimit: 500",
    "    corsOrigins:",
    "      - https://app.example.com",
    "      - https://admin.example.com",
    "templates:",
    "  ok: '[{{status}}] {{route}} -> {{service}} ({{paramsJson}}) ttl={{ttl}}'",
    "  notFound: '[404] No route for {{method}} {{path}}'",
    "  summary: 'Gateway {{name}}@{{version}}: {{routeCount}} routes across {{serviceCount}} upstreams'",
    "upstreams:",
    "  auth:",
    "    host: auth.internal",
    "    port: 8081",
    "    retries: 2",
    "  catalog:",
    "    host: catalog.internal",
    "    port: 8082",
    "    retries: 3",
    "  billing:",
    "    host: billing.internal",
    "    port: 8083",
    "    retries: 1",
    "  analytics:",
    "    host: analytics.internal",
    "    port: 8084",
    "    retries: 0",
    "routes:",
    "  - method: GET",
    "    pattern: /health",
    "    upstream: auth",
    "    ttl: 5",
    "  - method: POST",
    "    pattern: /v1/login",
    "    upstream: auth",
    "    ttl: 0",
    "  - method: GET",
    "    pattern: /v1/users/:userId",
    "    upstream: auth",
    "    ttl: 60",
    "  - method: GET",
    "    pattern: /v1/users/:userId/orgs/:orgId",
    "    upstream: auth",
    "    ttl: 90",
    "  - method: GET",
    "    pattern: /v1/products",
    "    upstream: catalog",
    "    ttl: 300",
    "  - method: GET",
    "    pattern: /v1/products/:sku",
    "    upstream: catalog",
    "    ttl: 300",
    "  - method: GET",
    "    pattern: /v1/categories/:cat/items/:sku",
    "    upstream: catalog",
    "    ttl: 180",
    "  - method: POST",
    "    pattern: /v1/invoices/:invoiceId/pay",
    "    upstream: billing",
    "    ttl: 0",
    "  - method: GET",
    "    pattern: /v1/invoices/:invoiceId",
    "    upstream: billing",
    "    ttl: 30",
    "  - method: POST",
    "    pattern: /v1/events/:stream",
    "    upstream: analytics",
    "    ttl: 0"
  ].join("\\n");

  var config = jsyaml.load(manifestYaml);
  Mustache.parse(config.templates.ok);
  Mustache.parse(config.templates.notFound);
  Mustache.parse(config.templates.summary);

  var compiledRoutes = config.routes.map(function(r) {
    var keys = [];
    var regexSrc = "^" + r.pattern.replace(/:([A-Za-z0-9_]+)/g, function(_, key) {
      keys.push(key);
      return "([^/]+)";
    }) + "$";
    var up = config.upstreams[r.upstream];
    return {
      method: r.method,
      pattern: r.pattern,
      re: new RegExp(regexSrc),
      keys: keys,
      endpoint: up.host + ":" + up.port,
      retries: up.retries,
      ttl: r.ttl != null ? r.ttl : config.service.defaults.cacheTtl
    };
  });

  var bootSummary = Mustache.render(config.templates.summary, {
    name: config.service.name,
    version: config.service.version,
    routeCount: compiledRoutes.length,
    serviceCount: Object.keys(config.upstreams).length
  });

  function dispatch(method, pathStr) {
    for (var i = 0; i < compiledRoutes.length; i++) {
      var rt = compiledRoutes[i];
      if (rt.method !== method) continue;
      var m = rt.re.exec(pathStr);
      if (m) {
        var params = {};
        for (var j = 0; j < rt.keys.length; j++) {
          params[rt.keys[j]] = decodeURIComponent(m[j + 1]);
        }
        return Mustache.render(config.templates.ok, {
          status: 200,
          route: rt.method + " " + rt.pattern,
          service: rt.endpoint,
          paramsJson: JSON.stringify(params),
          ttl: rt.ttl
        });
      }
    }
    return Mustache.render(config.templates.notFound, { method: method, path: pathStr });
  }

  root.YamlRouterApp = {
    bootSummary: bootSummary,
    corsOrigins: config.service.defaults.corsOrigins,
    dispatch: dispatch,
    dumpNormalized: function(obj) { return jsyaml.dump(obj, { sortKeys: true }).trim(); }
  };
})(${ROOT_EXPR});
`;
      return yaml + "\n;\n" + mustache + "\n" + appInit;
    },
    smokeCode: `(function(root) {
      var app = root.YamlRouterApp;
      return JSON.stringify({
        summary: app.bootSummary,
        cors: app.corsOrigins,
        r1: app.dispatch("GET", "/v1/users/42/orgs/acme"),
        r2: app.dispatch("GET", "/v1/categories/keyboards/items/KB-87"),
        r3: app.dispatch("POST", "/v1/invoices/inv_99/pay"),
        r4: app.dispatch("DELETE", "/v1/unknown"),
        dumped: app.dumpNormalized({ z: [1, 2], a: true })
      });
    })`,
  },
];

module.exports = { SPECS };
