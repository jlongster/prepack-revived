// hard: real-world
// source: new (React-like component tree rendered to a string, cf. #2140/#2141)
// goal: inline components into the optimized root; abstract props flow through conditionals and lists
function h(tag, props, children) {
  return { tag: tag, props: props || {}, children: children || [] };
}
function renderToString(node) {
  if (typeof node === "string") return node;
  var attrs = Object.keys(node.props)
    .map(function(k) {
      return " " + k + '="' + node.props[k] + '"';
    })
    .join("");
  return "<" + node.tag + attrs + ">" + node.children.map(renderToString).join("") + "</" + node.tag + ">";
}
function Badge(props) {
  return props.count > 0 ? h("span", { class: "badge" }, [String(props.count)]) : "";
}
function Header(props) {
  return h("header", { class: props.dark ? "dark" : "light" }, [h("h1", null, [props.title]), Badge({ count: props.unread })]);
}
function App(props) {
  return renderToString(h("div", { id: "root" }, [Header(props)]));
}
if (global.__optimize) __optimize(App);

inspect = function() {
  return App({ dark: true, title: "Inbox", unread: 3 }) + "\n" + App({ dark: false, title: "Done", unread: 0 });
};
