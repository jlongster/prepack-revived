// Helpers that stay in the specialized output. They are called from residual code only when the
// value they process is unknown at specialization time, must be self-contained (they may only
// reference each other and built-ins), and must compute exactly what the corresponding model code
// in runtime.js computes.

// escapeHtml from react-dom (same output, single pass).
function __ssrEscape(value) {
  var str = "" + value;
  var length = str.length;
  var index = 0;
  for (; index < length; index++) {
    var code = str.charCodeAt(index);
    if (code === 34 || code === 38 || code === 39 || code === 60 || code === 62) break;
  }
  if (index === length) return str;
  var html = "";
  var lastIndex = 0;
  for (; index < length; index++) {
    var escape;
    switch (str.charCodeAt(index)) {
      case 34:
        escape = "&quot;";
        break;
      case 38:
        escape = "&amp;";
        break;
      case 39:
        escape = "&#x27;";
        break;
      case 60:
        escape = "&lt;";
        break;
      case 62:
        escape = "&gt;";
        break;
      default:
        continue;
    }
    if (lastIndex !== index) html += str.substring(lastIndex, index);
    lastIndex = index + 1;
    html += escape;
  }
  return lastIndex !== index ? html + str.substring(lastIndex, index) : html;
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
