"use strict";
// A small app exercising React features beyond the react-bench app (classic JSX runtime output).
var React = require("react");
var h = React.createElement;

var Theme = React.createContext("light");

var Button = React.forwardRef(function Button(props, ref) {
  var id = React.useId();
  return h("button", { id: id, ref: ref, className: "btn " + props.kind, disabled: !!props.off, onClick: function () {} }, props.children);
});

var Badge = React.memo(function Badge(props) {
  return h("span", { className: "badge", "data-n": props.n, "aria-hidden": props.n === 0 }, props.label, ": ", props.n);
});
Badge.defaultProps = { label: "count" };

class Panel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: props.initiallyOpen };
  }
  render() {
    var theme = this.context;
    return h("section", { className: "panel " + theme, hidden: !this.state.open },
      h("h2", null, this.props.title),
      this.props.children);
  }
}
Panel.contextType = Theme;

function Counter(props) {
  var st = React.useState(function () { return props.start * 2; });
  var ref = React.useRef(null);
  var onClick = React.useCallback(function () { st[1](st[0] + 1); }, [st[0]]);
  return h("output", { ref: ref, onClick: onClick, style: { fontSize: props.size, marginTop: 0, "--accent": props.accent, flexGrow: 2 } }, st[0]);
}

function Row(props) {
  var item = props.item;
  return h(React.Fragment, null,
    h("dt", { title: item.name }, item.name),
    h("dd", null, item.qty > 1 ? item.qty + " units" : "single", item.note ? h("em", null, " (", item.note, ")") : null));
}

function Form(props) {
  return h("form", null,
    h("textarea", { name: "msg", defaultValue: props.message }),
    h("select", { name: "size", defaultValue: props.size },
      h("option", { value: "s" }, "Small"),
      h("option", { value: "m" }, "Medium"),
      h("option", { value: "l" }, "Large")),
    h("input", { type: "number", min: 0, value: props.count, readOnly: true }),
    h("img", { src: props.img, alt: props.alt, width: 10 }));
}

function Sections(props) {
  var d = props.data;
  var total = props.total;
  return h("main", { id: "root", "data-total": total },
    h(Panel, { title: d.title, initiallyOpen: d.open },
      h(Badge, { n: total }),
      h(Badge, { n: d.items.length, label: "rows" }),
      h(Theme.Consumer, null, function (t) { return h("i", null, "theme is ", t); }),
      d.items.length ? h("dl", null, d.items.map(function (it, i) { return h(Row, { key: i, item: it }); })) : h("p", null, "empty")),
    h(Counter, { start: total, size: d.size, accent: d.accent }),
    h(Form, { message: d.message, size: d.sizeCode, count: total, img: d.img, alt: d.alt }),
    d.tags.map(function (tag) { return h(Button, { key: tag, kind: tag, off: tag === d.disabledTag }, "#", tag); }),
    "tail text",
    d.footer);
}

function App(props) {
  var d = props.data;
  var total = React.useMemo(function () {
    var t = 0;
    for (var i = 0; i < d.items.length; i++) t += d.items[i].qty;
    return t;
  }, [d.items]);
  return h(Theme.Provider, { value: d.theme }, h(React.StrictMode, null, h(Sections, { data: d, total: total })));
}

module.exports = App;
