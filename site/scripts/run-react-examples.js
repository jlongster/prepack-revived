// Specializes small React apps built from real components of the react-bench storefront
// (react-bench/app/app.jsx) with the revived Prepack's React SSR compiler (react-ssr/compiler.js),
// checks every result against ReactDOMServer.renderToString on the benchmark's 500-input check
// corpus, times both, and records the generated code in site/data/react-examples.json.
//
//   node site/scripts/run-react-examples.js [ids…]
"use strict";
const fs = require("fs");
const path = require("path");

const SITE = path.resolve(__dirname, "..");
const REPO = path.resolve(SITE, "..");
const BENCH = process.env.REACT_BENCH || "/tmp/opencode/pp-wt/react-bench/react-bench";
const { React, ReactDOMServer, reactRequire } = require(path.join(BENCH, "react-deps.js"));
const data = require(path.join(BENCH, "data.js"));
const compiler = require(path.join(REPO, "react-ssr", "compiler.js"));
const Babel = reactRequire("@babel/standalone");

const appJsx = fs.readFileSync(path.join(BENCH, "app/app.jsx"), "utf8");
// Everything before the first component: require("react"), the three contexts and the helpers.
const prelude = appJsx.slice(0, appJsx.indexOf("// 1. CountPill"));
const fn = name => {
  const m = appJsx.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m"));
  if (!m) throw new Error("component not found: " + name);
  return m[0];
};

const EXAMPLES = [
  {
    id: "react-list",
    components: ["ProductBadges", "StockBadge"],
    show: ["ProductBadges"],
    root: `
function ProductList(props) {
  return (
    <ul className="ns-grid">
      {props.products.map(function (p) {
        return (
          <li key={p.sku} className={cx("ns-card", { "ns-card-out": p.stock <= 0 })}>
            <ProductBadges product={p} />
            <h3 className="ns-card-title">{p.title}</h3>
            <StockBadge stock={p.stock} shipsAtSec={p.shipsAtSec} />
          </li>
        );
      })}
    </ul>
  );
}
function App(props) {
  return <ProductList products={props.data.products} />;
}`,
  },
  {
    id: "react-cart",
    components: ["ActionButton", "CartLineItem", "CartSummaryAside"],
    show: ["CartSummaryAside", "CartLineItem"],
    root: `
function App(props) {
  var data = props.data;
  return (
    <LocaleContext.Provider value={data.locale}>
      <UserContext.Provider value={data.user}>
        <CartSummaryAside cart={data.cart} />
      </UserContext.Provider>
    </LocaleContext.Provider>
  );
}`,
  },
  {
    id: "react-filters",
    components: ["CountPill", "FilterOption", "FilterGroup", "FilterSidebar"],
    show: ["FilterSidebar", "FilterGroup", "FilterOption"],
    root: `
function App(props) {
  var data = props.data;
  return (
    <LocaleContext.Provider value={data.locale}>
      <FilterSidebar filters={data.filters} inStockOnly={data.search.inStockOnly} />
    </LocaleContext.Provider>
  );
}`,
  },
  {
    id: "react-banner",
    components: ["AnnouncementBanner", "Breadcrumbs"],
    show: ["AnnouncementBanner", "Breadcrumbs"],
    root: `
function App(props) {
  var data = props.data;
  return (
    <LocaleContext.Provider value={data.locale}>
      <AnnouncementBanner promo={data.promo} />
      <Breadcrumbs breadcrumbs={data.breadcrumbs} />
    </LocaleContext.Provider>
  );
}`,
  },
];

// Two app shapes that still produce broken output (found while building the Northstar store). Each
// is compiled from synthetic, seeded data and its output is run against renderToString.
const LIMITS = [
  {
    id: "limit-nullable-list",
    source: `
function Grid(props) {
  return <ul className="grid">{props.products.map(function (p) {
    return <li key={p.sku}>{p.title}{p.stock > 0 ? " in stock" : null}</li>;
  })}</ul>;
}
function Listing(props) {
  var inStock = React.useMemo(function () {
    var n = 0;
    for (var i = 0; i < props.listing.products.length; i++) if (props.listing.products[i].stock > 0) n++;
    return n;
  }, [props.listing]);
  return <section><h1>{props.listing.title}</h1><p>{inStock} in stock</p><Grid products={props.listing.products} /></section>;
}
function App(props) {
  var listing = props.data.listing; // null, or { title, products: [...] }
  return <main>{listing ? <Listing listing={listing} /> : <p>No listing</p>}</main>;
}`,
    gen: (rnd, products) => ({ listing: rnd() < 0.3 ? null : { title: "L" + Math.floor(rnd() * 9), products: products() } }),
  },
  {
    id: "limit-loop-and-map",
    source: `
function Grid(props) {
  return <ul className="grid">{props.products.map(function (p) {
    return <li key={p.sku}>{p.title}</li>;
  })}</ul>;
}
function ListingPage(props) {
  var inStock = React.useMemo(function () {
    var n = 0;
    for (var i = 0; i < props.products.length; i++) if (props.products[i].stock > 0) n++;
    return n;
  }, [props.products]);
  return <section><p>{inStock} in stock</p><Grid products={props.products} /></section>;
}
function App(props) {
  var data = props.data;
  return <main>{data.view === "listing" ? <ListingPage products={data.products} /> : <p>Home</p>}</main>;
}`,
    gen: (rnd, products) => ({ view: rnd() < 0.5 ? "listing" : "home", products: products() }),
  },
];

function runLimit(lim) {
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const products = () => {
    const a = [];
    for (let i = 0, n = Math.floor(rnd() * 4); i < n; i++) a.push({ sku: "S" + i, title: "T<" + i, stock: Math.floor(rnd() * 3) });
    return a;
  };
  const jsx = `var React = require("react");\n${lim.source}\nmodule.exports = App;\n`;
  const appCode = Babel.transform(jsx, { plugins: [["transform-react-jsx", { runtime: "classic", useBuiltIns: true }]] }).code;
  const mod = { exports: {} };
  new Function("module", "exports", "require", appCode)(mod, mod.exports, reactRequire);
  const reference = d => ReactDOMServer.renderToString(React.createElement(mod.exports, { data: d }));
  const samples = [];
  for (let i = 0; i < 200; i++) samples.push(lim.gen(rnd, products));
  const result = compiler.compile(appCode, { samples });
  let identical = 0;
  let different = 0;
  let threw = 0;
  let firstError = null;
  for (let i = 0; i < 200; i++) {
    const d = lim.gen(rnd, products);
    try {
      if (result.render(d) === reference(d)) identical++;
      else different++;
    } catch (e) {
      threw++;
      firstError = firstError || e.message;
    }
  }
  return {
    source: lim.source.trim(),
    residualBailout: /__bailout/.test(result.code),
    inputs: 200,
    identical,
    different,
    threw,
    firstError,
  };
}

const only = process.argv.slice(2);
const outFile = path.join(SITE, "data/react-examples.json");
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};

const training = data.getTrainingCorpus(400, "small").concat(data.getTrainingCorpus(40, "large"));
const checks = data.getCheckCorpus();

for (const ex of EXAMPLES) {
  if (only.length && !only.includes(ex.id)) continue;
  const jsx = `${prelude}${ex.components.map(fn).join("\n\n")}\n${ex.root}\n\nmodule.exports = App;\n`;
  const appCode = Babel.transform(jsx, {
    filename: ex.id + ".jsx",
    plugins: [["transform-react-jsx", { runtime: "classic", useBuiltIns: true }]],
  }).code.replace(/\/\*#__PURE__\*\//g, "");
  const mod = { exports: {} };
  new Function("module", "exports", "require", appCode)(mod, mod.exports, reactRequire);
  const App = mod.exports;
  const reference = d => ReactDOMServer.renderToString(React.createElement(App, { data: d }));
  let fallbacks = 0;
  const t0 = Date.now();
  const result = compiler.compile(appCode, {
    samples: training,
    fallback: d => {
      fallbacks++;
      return reference(d);
    },
  });
  const compileMs = Date.now() - t0;

  let identical = 0;
  const mismatches = [];
  for (const d of checks) {
    const a = result.render(d);
    const b = reference(d);
    if (a === b) identical++;
    else if (mismatches.length < 3) mismatches.push({ expected: b.slice(0, 200), actual: a.slice(0, 200) });
  }
  const checkFallbacks = fallbacks;

  // Warm, interleaved timing over the whole check corpus (component-sized pages).
  const time = f => {
    const s = process.hrtime.bigint();
    for (const d of checks) f(d);
    return Number(process.hrtime.bigint() - s) / 1e3 / checks.length;
  };
  // The specialized function alone, without the per-request schema check that guards it.
  const sandbox = Object.create(globalThis);
  new Function(result.code).call(sandbox);
  const bare = sandbox.__ssrRender;
  for (let i = 0; i < 3; i++) {
    time(reference);
    time(result.render);
    time(bare);
  }
  const rounds = [];
  for (let i = 0; i < 7; i++) rounds.push({ react: time(reference), prepack: time(result.render), bare: time(bare) });
  const median = xs => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  const reactUs = median(rounds.map(r => r.react));
  const prepackUs = median(rounds.map(r => r.prepack));
  const bareUs = median(rounds.map(r => r.bare));

  out[ex.id] = {
    input: ex.show.map(fn).join("\n\n"),
    root: ex.root.trim(),
    components: ex.components,
    code: result.code,
    stats: Object.assign({}, result.stats, { compileMs }),
    check: { inputs: checks.length, identical, fallbacks: checkFallbacks, mismatches },
    perf: { reactUs, prepackUs, bareUs, speedup: reactUs / prepackUs, bareSpeedup: reactUs / bareUs },
  };
  console.log(
    `${ex.id}: compiled in ${compileMs} ms, ${identical}/${checks.length} identical, ${checkFallbacks} fallbacks, ` +
      `React ${reactUs.toFixed(1)} µs vs Prepack ${prepackUs.toFixed(1)} µs (${(reactUs / prepackUs).toFixed(1)}×), ` +
      `render alone ${bareUs.toFixed(1)} µs (${(reactUs / bareUs).toFixed(1)}×)`
  );
}
for (const lim of LIMITS) {
  if (only.length && !only.includes(lim.id)) continue;
  out[lim.id] = runLimit(lim);
  const r = out[lim.id];
  console.log(`${lim.id}: __bailout in output: ${r.residualBailout}; ${r.identical} identical, ${r.different} different, ${r.threw} threw (${r.firstError})`);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
