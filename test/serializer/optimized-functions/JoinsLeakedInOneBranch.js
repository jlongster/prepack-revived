// An object that leaks on only one side of a conditional must be treated as leaked on both sides after the join;
// otherwise its stale property values are materialized again later and overwrite what unknown code did to it.
function f(a, g) {
  var o = { x: 1 };
  if (a) g(o);
  g(o);
  return o.x;
}

if (global.__optimize) __optimize(f);

inspect = function() {
  var inc = function(o) {
    o.x++;
  };
  return [f(true, inc), f(false, inc)].join();
};
