// Helpers that stay in the specialized output. They are called from residual code only when the
// value they process is unknown at specialization time, must be self-contained (they may only
// reference each other and built-ins), and must compute exactly what the corresponding model code
// in runtime.js computes.

// escapeHtml from react-dom (same output: each of "&'<> is replaced independently).
var __ssrEscapeTest = /["'&<>]/;
var __ssrEscapeAll = /["'&<>]/g;
function __ssrEscapeChar(c) {
  switch (c) {
    case '"':
      return "&quot;";
    case "&":
      return "&amp;";
    case "'":
      return "&#x27;";
    case "<":
      return "&lt;";
    default:
      return "&gt;";
  }
}
function __ssrEscape(value) {
  var str = "" + value;
  return __ssrEscapeTest.test(str) ? str.replace(__ssrEscapeAll, __ssrEscapeChar) : str;
}

// array.map(f).join("") without the intermediate array (and without flattening the result):
// map calls f only for present indices, and join("") turns holes into "". f returns strings.
function __ssrMapJoin(array, f) {
  var html = "";
  for (var i = 0, n = array.length; i < n; i++) {
    if (i in array) html += f(array[i], i, array);
  }
  return html;
}

// A non-number CSS value: escapeTextForBrowser(('' + value).trim()).
function __ssrTrimEscape(value) {
  return __ssrEscape(("" + value).trim());
}

// getTreeId
function __ssrTreeId(idWithLeadingBit, overflow) {
  var id = idWithLeadingBit & ~(1 << (31 - Math.clz32(idWithLeadingBit)));
  return id.toString(32) + overflow;
}

// pushTreeContext(...).id
function __ssrTreeContextId(baseIdWithLeadingBit, totalChildren, index) {
  var baseLength = 31 - Math.clz32(baseIdWithLeadingBit);
  var baseId = baseIdWithLeadingBit & ~(1 << baseLength);
  var slot = index + 1;
  var length = 32 - Math.clz32(totalChildren) + baseLength;
  if (length > 30) {
    var numberOfOverflowBits = baseLength - (baseLength % 5);
    var restOfBaseId = baseId >> numberOfOverflowBits;
    var restOfBaseLength = baseLength - numberOfOverflowBits;
    var restOfLength = 32 - Math.clz32(totalChildren) + restOfBaseLength;
    return (1 << restOfLength) | (slot << restOfBaseLength) | restOfBaseId;
  }
  return (1 << length) | (slot << baseLength) | baseId;
}

// pushTreeContext(...).overflow
function __ssrTreeContextOverflow(baseIdWithLeadingBit, baseOverflow, totalChildren) {
  var baseLength = 31 - Math.clz32(baseIdWithLeadingBit);
  var length = 32 - Math.clz32(totalChildren) + baseLength;
  if (length > 30) {
    var baseId = baseIdWithLeadingBit & ~(1 << baseLength);
    var numberOfOverflowBits = baseLength - (baseLength % 5);
    return (baseId & ((1 << numberOfOverflowBits) - 1)).toString(32) + baseOverflow;
  }
  return baseOverflow;
}

// renderNode for a child of unknown type, given the text separator state before it.
function __ssrRenderPrimitiveChild(node, embedded) {
  if (typeof node === "string") return node === "" ? "" : (embedded ? "<!-- -->" : "") + __ssrEscape(node);
  if (typeof node === "number") return (embedded ? "<!-- -->" : "") + node;
  if (typeof node === "object" && node !== null) {
    throw new Error("react-ssr: an object child of unknown shape cannot be rendered by the specialized renderer");
  }
  return "";
}

// The text separator state after __ssrRenderPrimitiveChild(node, embedded).
function __ssrIsTextChild(node, embedded) {
  if (typeof node === "string") return node === "" ? embedded : true;
  if (typeof node === "number") return true;
  return embedded;
}
