// throws introspection error
var globalCounter = 0;

function bad(n) {
  for (var i = 0; i < n; i++) {
    globalCounter++;
  }
  return globalCounter;
}

if (global.__optimize) __optimize(bad);

inspect = function() {
  return bad(3);
};
