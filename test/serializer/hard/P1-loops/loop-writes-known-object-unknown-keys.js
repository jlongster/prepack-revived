// hard: P1
// source: https://github.com/facebookarchive/prepack/issues/1174 (summary "unknown properties on known objects")
// goal: loop over abstract array writing abstract keys into a fresh object; residual loop; object stays known otherwise
function index(list) {
  var byId = { _meta: "index" };
  for (var i = 0; i < list.length; i++) {
    byId[list[i].id] = list[i].name;
  }
  return byId;
}
if (global.__optimize) __optimize(index);

inspect = function() {
  return JSON.stringify([index([{ id: "a", name: "A" }, { id: "b", name: "B" }]), index([])]);
};
