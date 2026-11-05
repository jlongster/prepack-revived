// hard: real-world
// source: new (route table compiled at init, matched at runtime)
// goal: compile route patterns to RegExps at build time; optimized match over an abstract path; no FatalError
var routes = [
  { pattern: "/", name: "home" },
  { pattern: "/users/:id", name: "user" },
  { pattern: "/users/:id/posts/:post", name: "post" },
].map(function(r) {
  var keys = [];
  var src = r.pattern.replace(/:(\w+)/g, function(_, k) {
    keys.push(k);
    return "([^/]+)";
  });
  return { name: r.name, keys: keys, re: new RegExp("^" + src + "$") };
});

function match(path) {
  for (var i = 0; i < routes.length; i++) {
    var m = routes[i].re.exec(path);
    if (m) {
      var params = {};
      routes[i].keys.forEach(function(k, j) {
        params[k] = m[j + 1];
      });
      return routes[i].name + JSON.stringify(params);
    }
  }
  return "404";
}
if (global.__optimize) __optimize(match);

inspect = function() {
  return ["/", "/users/7", "/users/7/posts/abc", "/nope"].map(match).join(",");
};
