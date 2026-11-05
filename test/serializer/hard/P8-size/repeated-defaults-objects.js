// hard: P8
// source: new (object duplication)
// goal: objects built by a loop from shared defaults should not each be serialized in full; output <= 2x input
var defaults = { color: "red", size: "medium", visible: true, tags: ["a", "b"], margin: { top: 0, left: 0 } };
var items = [];
for (var i = 0; i < 40; i++) {
  items.push(Object.assign({ id: "item" + i }, defaults));
}

inspect = function() {
  return items.length + ":" + items[39].id + ":" + (items[0].tags === items[39].tags) + items[7].margin.top;
};
