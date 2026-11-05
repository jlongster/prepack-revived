// React 18 server rendering model for Prepack.
//
// This file is a port of the parts of react@18.3.1 / react-dom@18.3.1 (Fizz, legacy
// renderToString) that a synchronous, non-suspending server render goes through, written so that
// Prepack can specialize it: string results instead of chunk arrays, no caches or other global
// mutable state that survives a render, and every piece of per-render state saved and restored
// around nested work (so that callbacks evaluated for unknown-length arrays have no net effect).
//
// The model is evaluated in two ways:
//  - by Prepack (global code), with HOST bound to Prepack intrinsics; the rendering function is
//    then specialized for abstract props;
//  - by plain Node (HOST bound to identity functions), to check the model against
//    react-dom/server on concrete inputs.
//
// It is assembled by react-ssr/compiler.js: the DOM_TABLES marker below is replaced by verbatim tables
// from react-dom (attribute property infos, unitless CSS properties).
//
// HOST interface:
//   isAbstract(v)          is v unknown at specialization time
//   types(v)               comma separated possible typeof results (see __possibleTypes)
//   condParts(v)           [cond, a, b] if v is an abstract conditional, else undefined
//   concatParts(v)         [a, b] if v is an abstract string concatenation a + b, else undefined
//   str1/str2/str3(fn, ...) residual call of fn with 1/2/3 arguments, whose result is a string
//                          (pure: fn must not throw or depend on state; results may be shared)
//   bool2(fn, a, b)        pure residual call fn(a, b) whose result is a boolean
//   strT2/boolT2(fn, a, b) residual call kept in order (fn may throw)
//   num3(fn, a, b, c)      residual call fn(a, b, c) whose result is a number
//   widen(array)           a view of an array of unknown length whose map callbacks get
//                          specialized (undefined if impossible)
//   bail(message)          refuse to specialize (Prepack: fatal diagnostic; Node: throws)

var __SSR = (function (HOST) {
  "use strict";

  /*@@DOM_TABLES@@*/

  var isArrayImpl = Array.isArray;
  function isArray(a) {
    return isArrayImpl(a);
  }

  // ---------------------------------------------------------------------------------------------
  // Symbols and element creation (react/cjs/react.development.js)

  var REACT_ELEMENT_TYPE = Symbol.for("react.element");
  var REACT_PORTAL_TYPE = Symbol.for("react.portal");
  var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
  var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
  var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
  var REACT_PROVIDER_TYPE = Symbol.for("react.provider");
  var REACT_CONTEXT_TYPE = Symbol.for("react.context");
  var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
  var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
  var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
  var REACT_MEMO_TYPE = Symbol.for("react.memo");
  var REACT_LAZY_TYPE = Symbol.for("react.lazy");
  var REACT_SCOPE_TYPE = Symbol.for("react.scope");
  var REACT_DEBUG_TRACING_MODE_TYPE = Symbol.for("react.debug_trace_mode");
  var REACT_LEGACY_HIDDEN_TYPE = Symbol.for("react.legacy_hidden");
  // Not a React type: the children `xs.map(f)` of a host element, where xs is an array of unknown
  // length. Rendered as a residual loop (see renderAbstractArray).
  var SSR_MAPPED_CHILDREN = Symbol.for("react-ssr.mapped_children");

  var RESERVED_PROPS = { key: true, ref: true, __self: true, __source: true };

  function ReactElement(type, key, ref, props) {
    return { $$typeof: REACT_ELEMENT_TYPE, type: type, key: key, ref: ref, props: props, _owner: null };
  }

  function createElement(type, config, children) {
    var propName;
    var props = {};
    var key = null;
    var ref = null;
    if (config != null) {
      if (config.ref !== undefined) ref = config.ref;
      if (config.key !== undefined) key = "" + config.key;
      for (propName in config) {
        if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
          props[propName] = config[propName];
        }
      }
    }
    var childrenLength = arguments.length - 2;
    if (childrenLength === 1) {
      props.children = children;
    } else if (childrenLength > 1) {
      var childArray = [];
      for (var i = 0; i < childrenLength; i++) childArray.push(arguments[i + 2]);
      props.children = childArray;
    }
    if (type && type.defaultProps) {
      var defaultProps = type.defaultProps;
      for (propName in defaultProps) {
        if (props[propName] === undefined) props[propName] = defaultProps[propName];
      }
    }
    return ReactElement(type, key, ref, props);
  }

  function cloneElement(element, config, children) {
    if (element === null || element === undefined) {
      throw new Error("React.cloneElement(...): The argument must be a React element, but you passed " + element + ".");
    }
    var propName;
    var props = Object.assign({}, element.props);
    var key = element.key;
    var ref = element.ref;
    if (config != null) {
      if (config.ref !== undefined) ref = config.ref;
      if (config.key !== undefined) key = "" + config.key;
      var defaultProps;
      if (element.type && element.type.defaultProps) defaultProps = element.type.defaultProps;
      for (propName in config) {
        if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
          if (config[propName] === undefined && defaultProps !== undefined) props[propName] = defaultProps[propName];
          else props[propName] = config[propName];
        }
      }
    }
    var childrenLength = arguments.length - 2;
    if (childrenLength === 1) {
      props.children = children;
    } else if (childrenLength > 1) {
      var childArray = [];
      for (var i = 0; i < childrenLength; i++) childArray.push(arguments[i + 2]);
      props.children = childArray;
    }
    return ReactElement(element.type, key, ref, props);
  }

  function isValidElement(object) {
    return typeof object === "object" && object !== null && object.$$typeof === REACT_ELEMENT_TYPE;
  }

  function createRef() {
    return { current: null };
  }

  function forwardRef(render) {
    return { $$typeof: REACT_FORWARD_REF_TYPE, render: render };
  }

  function memo(type, compare) {
    return { $$typeof: REACT_MEMO_TYPE, type: type, compare: compare === undefined ? null : compare };
  }

  function lazy() {
    HOST.bail("React.lazy is not supported by the specializing server renderer");
  }

  var contexts = [];
  function createContext(defaultValue) {
    var context = {
      $$typeof: REACT_CONTEXT_TYPE,
      _currentValue: defaultValue,
      _currentValue2: defaultValue,
      _threadCount: 0,
      Provider: null,
      Consumer: null,
      _defaultValue: null,
      _globalName: null,
      _ssrIndex: contexts.length,
    };
    context.Provider = { $$typeof: REACT_PROVIDER_TYPE, _context: context };
    context.Consumer = context;
    contexts.push(context);
    return context;
  }

  // React.Children over concrete children (mapChildren / mapIntoArray, without key rewriting:
  // keys are not observable in server rendered markup).
  function forEachChild(children, fn) {
    if (children === undefined || typeof children === "boolean") children = null;
    if (HOST.isAbstract(children) || (isArray(children) && HOST.isAbstract(children.length))) {
      HOST.bail("React.Children over children of unknown shape is not supported");
    }
    if (isArray(children)) {
      for (var i = 0; i < children.length; i++) forEachChild(children[i], fn);
      return;
    }
    if (typeof children === "object" && children !== null && children.$$typeof === SSR_MAPPED_CHILDREN) {
      HOST.bail("React.Children over mapped children of unknown length is not supported");
    }
    fn(children);
  }
  var Children = {
    map: function (children, fn, ctx) {
      if (children == null) return children;
      var result = [];
      var count = 0;
      forEachChild(children, function (child) {
        var mapped = fn.call(ctx, child, count++);
        if (isArray(mapped)) {
          forEachChild(mapped, function (c) {
            if (c != null) result.push(c);
          });
        } else if (mapped != null) {
          result.push(mapped);
        }
      });
      return result;
    },
    forEach: function (children, fn, ctx) {
      if (children == null) return;
      var count = 0;
      forEachChild(children, function (child) {
        fn.call(ctx, child, count++);
      });
    },
    count: function (children) {
      var n = 0;
      if (children == null) return 0;
      forEachChild(children, function () {
        n++;
      });
      return n;
    },
    toArray: function (children) {
      var result = [];
      if (children == null) return result;
      forEachChild(children, function (child) {
        if (child != null) result.push(child);
      });
      return result;
    },
    only: function (children) {
      if (!isValidElement(children)) {
        throw new Error("React.Children.only expected to receive a single React element child.");
      }
      return children;
    },
  };

  function Component(props, context, updater) {
    this.props = props;
    this.context = context;
    this.refs = {};
    this.updater = updater || classUpdater;
  }
  Component.prototype.isReactComponent = {};
  Component.prototype.setState = function (partialState, callback) {
    this.updater.enqueueSetState(this, partialState, callback, "setState");
  };
  Component.prototype.forceUpdate = function () {};
  function PureComponent(props, context, updater) {
    this.props = props;
    this.context = context;
    this.refs = {};
    this.updater = updater || classUpdater;
  }
  PureComponent.prototype = Object.create(Component.prototype);
  PureComponent.prototype.constructor = PureComponent;
  PureComponent.prototype.isPureReactComponent = true;

  // Outside of componentWillMount, Fizz ignores updates (warnNoop).
  var classUpdater = {
    isMounted: function () {
      return false;
    },
    enqueueSetState: function () {},
    enqueueReplaceState: function () {},
    enqueueForceUpdate: function () {},
  };

  // `xs.map(f)` as a child of a host element. Arrays of known length are mapped as usual.
  function mapChildren(xs, f, thisArg) {
    if (isArray(xs) && !HOST.isAbstract(xs.length)) return xs.map(f, thisArg);
    if (thisArg !== undefined) HOST.bail("Array.prototype.map with a thisArg over an array of unknown length");
    return { $$typeof: SSR_MAPPED_CHILDREN, array: xs, fn: f };
  }

  // ---------------------------------------------------------------------------------------------
  // Hooks (react-dom-server Fizz hooks, first render only)

  var localIdCounter = 0;
  var renderingComponent = false;

  function useContext(context) {
    return readContext(context);
  }
  function useState(initialState) {
    return useReducer(basicStateReducer, initialState);
  }
  function basicStateReducer(state, action) {
    return typeof action === "function" ? action(state) : action;
  }
  function useReducer(reducer, initialArg, init) {
    var initialState;
    if (reducer === basicStateReducer) {
      initialState = typeof initialArg === "function" ? initialArg() : initialArg;
    } else {
      initialState = init !== undefined ? init(initialArg) : initialArg;
    }
    return [initialState, dispatchDuringRender];
  }
  function dispatchDuringRender() {
    if (renderingComponent) HOST.bail("state updates during render are not supported");
  }
  function useMemo(nextCreate) {
    return nextCreate();
  }
  function useCallback(callback) {
    return callback;
  }
  function useRef(initialValue) {
    return { current: initialValue };
  }
  function noop() {}
  function useDeferredValue(value) {
    return value;
  }
  function unsupportedStartTransition() {
    throw new Error("startTransition cannot be called during server rendering.");
  }
  function useTransition() {
    return [false, unsupportedStartTransition];
  }
  function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
    if (getServerSnapshot === undefined) {
      throw new Error(
        "Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering."
      );
    }
    return getServerSnapshot();
  }
  function useMutableSource(source, getSnapshot) {
    return getSnapshot(source._source);
  }
  function useId() {
    var treeId = getTreeId(state.tree);
    var localId = localIdCounter++;
    // makeId with an empty identifierPrefix
    var id = ":R" + treeId;
    if (localId > 0) id += "H" + localId.toString(32);
    return id + ":";
  }

  // ---------------------------------------------------------------------------------------------
  // Tree context (ReactFizzTreeContext): ids for useId.

  // A tree context is either concrete ({ id, overflow }) or, below an array of unknown length,
  // lazy ({ parent, totalChildren, index }): ids are only computed (by residual code) when useId
  // reads them, so that rendering without useId pays nothing for the tree position bookkeeping.
  function getTreeId(context) {
    var concrete = materializeTreeContext(context);
    var overflow = concrete.overflow;
    var idWithLeadingBit = concrete.id;
    if (HOST.isAbstract(idWithLeadingBit) || HOST.isAbstract(overflow)) {
      return HOST.str2(__ssrTreeId, idWithLeadingBit, overflow);
    }
    var id = idWithLeadingBit & ~getLeadingBit(idWithLeadingBit);
    return id.toString(32) + overflow;
  }

  function materializeTreeContext(context) {
    if (context.parent === undefined) return context;
    var base = materializeTreeContext(context.parent);
    return {
      id: HOST.num3(__ssrTreeContextId, base.id, context.totalChildren, context.index),
      overflow: HOST.str3(__ssrTreeContextOverflow, base.id, base.overflow, context.totalChildren),
    };
  }

  function pushTreeContext(baseContext, totalChildren, index) {
    if (
      baseContext.parent !== undefined ||
      HOST.isAbstract(baseContext.id) ||
      HOST.isAbstract(baseContext.overflow) ||
      HOST.isAbstract(totalChildren) ||
      HOST.isAbstract(index)
    ) {
      return { parent: baseContext, totalChildren: totalChildren, index: index };
    }
    var baseIdWithLeadingBit = baseContext.id;
    var baseOverflow = baseContext.overflow;
    var baseLength = getBitLength(baseIdWithLeadingBit) - 1;
    var baseId = baseIdWithLeadingBit & ~(1 << baseLength);
    var slot = index + 1;
    var length = getBitLength(totalChildren) + baseLength;
    if (length > 30) {
      var numberOfOverflowBits = baseLength - (baseLength % 5);
      var newOverflowBits = (1 << numberOfOverflowBits) - 1;
      var newOverflow = (baseId & newOverflowBits).toString(32);
      var restOfBaseId = baseId >> numberOfOverflowBits;
      var restOfBaseLength = baseLength - numberOfOverflowBits;
      var restOfLength = getBitLength(totalChildren) + restOfBaseLength;
      var restOfNewBits = slot << restOfBaseLength;
      var id = restOfNewBits | restOfBaseId;
      var overflow = newOverflow + baseOverflow;
      return { id: (1 << restOfLength) | id, overflow: overflow };
    }
    var newBits = slot << baseLength;
    var _id = newBits | baseId;
    return { id: (1 << length) | _id, overflow: baseOverflow };
  }

  function getBitLength(number) {
    return 32 - Math.clz32(number);
  }

  function getLeadingBit(id) {
    return 1 << (getBitLength(id) - 1);
  }

  // ---------------------------------------------------------------------------------------------
  // Markup (ReactDOMServerFormatConfig)

  function escapeHtml(string) {
    var str = "" + string;
    var match = matchHtmlRegExp.exec(str);
    if (!match) return str;
    var escape;
    var html = "";
    var index;
    var lastIndex = 0;
    for (index = match.index; index < str.length; index++) {
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
  var matchHtmlRegExp = /["'&<>]/;

  function escapeTextForBrowser(text) {
    if (typeof text === "boolean" || typeof text === "number") return "" + text;
    if (HOST.isAbstract(text)) {
      // Escaping distributes over conditionals and over string concatenation (it maps each
      // character independently, and `a + b` converts both operands as "" + x does), so constant
      // parts are escaped now and only the unknown parts at runtime.
      var parts = HOST.condParts(text);
      if (parts !== undefined) {
        if (parts[0]) return escapeTextForBrowser(parts[1]);
        return escapeTextForBrowser(parts[2]);
      }
      var operands = HOST.concatParts(text);
      if (operands !== undefined) return escapeTextForBrowser(operands[0]) + escapeTextForBrowser(operands[1]);
      if (HOST.types(text) === "number") return "" + text;
      return HOST.str1(__ssrEscape, text);
    }
    return escapeHtml(text);
  }

  var uppercasePattern = /([A-Z])/g;
  var msPattern = /^ms-/;
  function hyphenateStyleName(name) {
    return name.replace(uppercasePattern, "-$1").toLowerCase().replace(msPattern, "-ms-");
  }

  function isAttributeNameSafe(attributeName) {
    return VALID_ATTRIBUTE_NAME_REGEX.test(attributeName);
  }

  function styleValueString(styleValue) {
    if (HOST.isAbstract(styleValue)) return HOST.str1(__ssrTrimEscape, styleValue);
    return escapeTextForBrowser(("" + styleValue).trim());
  }

  function pushStyle(style) {
    if (typeof style !== "object") {
      throw new Error(
        "The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX."
      );
    }
    var target = "";
    var isFirst = true;
    for (var styleName in style) {
      if (!hasOwnProperty.call(style, styleName)) continue;
      var styleValue = style[styleName];
      if (styleValue == null || typeof styleValue === "boolean" || styleValue === "") continue;
      var nameChunk;
      var valueChunk;
      var isCustomProperty = styleName.indexOf("--") === 0;
      if (isCustomProperty) {
        nameChunk = escapeTextForBrowser(styleName);
        valueChunk = styleValueString(styleValue);
      } else {
        nameChunk = escapeTextForBrowser(hyphenateStyleName(styleName));
        if (typeof styleValue === "number") {
          if (styleValue !== 0 && !hasOwnProperty.call(isUnitlessNumber, styleName)) {
            valueChunk = styleValue + "px";
          } else {
            valueChunk = "" + styleValue;
          }
        } else {
          valueChunk = styleValueString(styleValue);
        }
      }
      if (isFirst) {
        isFirst = false;
        target += ' style="' + nameChunk + ":" + valueChunk;
      } else {
        target += ";" + nameChunk + ":" + valueChunk;
      }
    }
    if (!isFirst) target += '"';
    return target;
  }

  function attributeValue(value) {
    return '="' + escapeTextForBrowser(value) + '"';
  }

  function pushAttribute(name, value) {
    switch (name) {
      case "style":
        return pushStyle(value);
      case "defaultValue":
      case "defaultChecked":
      case "innerHTML":
      case "suppressContentEditableWarning":
      case "suppressHydrationWarning":
        return "";
    }
    if (name.length > 2 && (name[0] === "o" || name[0] === "O") && (name[1] === "n" || name[1] === "N")) {
      return "";
    }
    var propertyInfo = getPropertyInfo(name);
    if (propertyInfo !== null) {
      switch (typeof value) {
        case "function":
        case "symbol":
          return "";
        case "boolean":
          if (!propertyInfo.acceptsBooleans) return "";
      }
      var attributeName = propertyInfo.attributeName;
      switch (propertyInfo.type) {
        case BOOLEAN:
          if (value) return " " + attributeName + '=""';
          return "";
        case OVERLOADED_BOOLEAN:
          if (value === true) return " " + attributeName + '=""';
          if (value === false) return "";
          return " " + attributeName + attributeValue(value);
        case NUMERIC:
          if (!isNaN(value)) return " " + attributeName + attributeValue(value);
          return "";
        case POSITIVE_NUMERIC:
          if (!isNaN(value) && value >= 1) return " " + attributeName + attributeValue(value);
          return "";
        default:
          if (propertyInfo.sanitizeURL) value = "" + value;
          return " " + attributeName + attributeValue(value);
      }
    } else if (isAttributeNameSafe(name)) {
      switch (typeof value) {
        case "function":
        case "symbol":
          return "";
        case "boolean": {
          var prefix = name.toLowerCase().slice(0, 5);
          if (prefix !== "data-" && prefix !== "aria-") return "";
        }
      }
      return " " + name + attributeValue(value);
    }
    return "";
  }

  function innerHTMLString(innerHTML, children) {
    if (innerHTML != null) {
      if (children != null) {
        throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
      }
      if (typeof innerHTML !== "object" || !("__html" in innerHTML)) {
        throw new Error(
          "`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://reactjs.org/link/dangerously-set-inner-html for more information."
        );
      }
      var html = innerHTML.__html;
      if (html !== null && html !== undefined) return "" + html;
    }
    return "";
  }

  var VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/;
  function startChunkForTag(tag) {
    if (!VALID_TAG_REGEX.test(tag)) throw new Error("Invalid tag: " + tag);
    return "<" + tag;
  }

  function Start(html, children) {
    return { html: html, children: children };
  }

  function pushStartSelect(props) {
    var target = startChunkForTag("select");
    var children = null;
    var innerHTML = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          case "defaultValue":
          case "value":
            break;
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    target += ">";
    target += innerHTMLString(innerHTML, children);
    return Start(target, children);
  }

  function flattenOptionChildren(children) {
    var content = "";
    Children.forEach(children, function (child) {
      if (child == null) return;
      content += child;
    });
    return content;
  }

  function pushStartOption(props, formatContext) {
    var selectedValue = formatContext.selectedValue;
    var target = startChunkForTag("option");
    var children = null;
    var value = null;
    var selected = null;
    var innerHTML = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "selected":
            selected = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          case "value":
            value = propValue;
            target += pushAttribute(propKey, propValue);
            break;
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    if (selectedValue != null) {
      var stringValue;
      if (value !== null) {
        stringValue = "" + value;
      } else {
        stringValue = flattenOptionChildren(children);
      }
      if (isArray(selectedValue)) {
        if (HOST.isAbstract(selectedValue.length)) HOST.bail("<select multiple> value of unknown length");
        for (var i = 0; i < selectedValue.length; i++) {
          var v = "" + selectedValue[i];
          if (v === stringValue) {
            target += ' selected=""';
            break;
          }
        }
      } else {
        if ("" + selectedValue === stringValue) target += ' selected=""';
      }
    } else if (selected) {
      target += ' selected=""';
    }
    target += ">";
    target += innerHTMLString(innerHTML, children);
    return Start(target, children);
  }

  function pushInput(props) {
    var target = startChunkForTag("input");
    var value = null;
    var defaultValue = null;
    var checked = null;
    var defaultChecked = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw new Error(
              "input is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`."
            );
          case "defaultChecked":
            defaultChecked = propValue;
            break;
          case "defaultValue":
            defaultValue = propValue;
            break;
          case "checked":
            checked = propValue;
            break;
          case "value":
            value = propValue;
            break;
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    if (checked !== null) {
      target += pushAttribute("checked", checked);
    } else if (defaultChecked !== null) {
      target += pushAttribute("checked", defaultChecked);
    }
    if (value !== null) {
      target += pushAttribute("value", value);
    } else if (defaultValue !== null) {
      target += pushAttribute("value", defaultValue);
    }
    target += "/>";
    return Start(target, null);
  }

  function pushStartTextArea(props) {
    var target = startChunkForTag("textarea");
    var value = null;
    var defaultValue = null;
    var children = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "value":
            value = propValue;
            break;
          case "defaultValue":
            defaultValue = propValue;
            break;
          case "dangerouslySetInnerHTML":
            throw new Error("`dangerouslySetInnerHTML` does not make sense on <textarea>.");
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    if (value === null && defaultValue !== null) value = defaultValue;
    target += ">";
    if (children != null) {
      if (value != null) throw new Error("If you supply `defaultValue` on a <textarea>, do not pass children.");
      if (isArray(children)) {
        if (children.length > 1) throw new Error("<textarea> can only have at most one child.");
        value = "" + children[0];
      }
      value = "" + children;
    }
    if (typeof value === "string" && value[0] === "\n") target += "\n";
    if (value !== null) target += escapeTextForBrowser("" + value);
    return Start(target, null);
  }

  function pushSelfClosing(props, tag) {
    var target = startChunkForTag(tag);
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw new Error(
              tag + " is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`."
            );
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    target += "/>";
    return Start(target, null);
  }

  function pushStartMenuItem(props) {
    var target = startChunkForTag("menuitem");
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw new Error("menuitems cannot have `children` nor `dangerouslySetInnerHTML`.");
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    target += ">";
    return Start(target, null);
  }

  function pushStartTitle(props) {
    var target = startChunkForTag("title");
    var children = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            throw new Error("`dangerouslySetInnerHTML` does not make sense on <title>.");
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    target += ">";
    return Start(target, children);
  }

  function pushStartGenericElement(props, tag) {
    var target = startChunkForTag(tag);
    var children = null;
    var innerHTML = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    target += ">";
    target += innerHTMLString(innerHTML, children);
    if (typeof children === "string") {
      target += escapeTextForBrowser(children);
      return Start(target, null);
    }
    return Start(target, children);
  }

  function pushStartCustomElement(props, tag) {
    var target = startChunkForTag(tag);
    var children = null;
    var innerHTML = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          case "style":
            target += pushStyle(propValue);
            break;
          case "suppressContentEditableWarning":
          case "suppressHydrationWarning":
            break;
          default:
            if (isAttributeNameSafe(propKey) && typeof propValue !== "function" && typeof propValue !== "symbol") {
              target += " " + propKey + attributeValue(propValue);
            }
            break;
        }
      }
    }
    target += ">";
    target += innerHTMLString(innerHTML, children);
    return Start(target, children);
  }

  function pushStartPreformattedElement(props, tag) {
    var target = startChunkForTag(tag);
    var children = null;
    var innerHTML = null;
    for (var propKey in props) {
      if (hasOwnProperty.call(props, propKey)) {
        var propValue = props[propKey];
        if (propValue == null) continue;
        switch (propKey) {
          case "children":
            children = propValue;
            break;
          case "dangerouslySetInnerHTML":
            innerHTML = propValue;
            break;
          default:
            target += pushAttribute(propKey, propValue);
            break;
        }
      }
    }
    target += ">";
    if (innerHTML != null) {
      if (children != null) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
      if (typeof innerHTML !== "object" || !("__html" in innerHTML)) {
        throw new Error(
          "`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://reactjs.org/link/dangerously-set-inner-html for more information."
        );
      }
      var html = innerHTML.__html;
      if (html !== null && html !== undefined) {
        if (typeof html === "string" && html.length > 0 && html[0] === "\n") {
          target += "\n" + html;
        } else {
          target += "" + html;
        }
      }
    }
    if (typeof children === "string" && children[0] === "\n") target += "\n";
    return Start(target, children);
  }

  var HTML_MODE = 1;
  var SVG_MODE = 2;
  var MATHML_MODE = 3;
  var HTML_TABLE_MODE = 4;
  var HTML_TABLE_BODY_MODE = 5;
  var HTML_TABLE_ROW_MODE = 6;
  var HTML_COLGROUP_MODE = 7;

  function createFormatContext(insertionMode, selectedValue) {
    return { insertionMode: insertionMode, selectedValue: selectedValue };
  }

  function getChildFormatContext(parentContext, type, props) {
    switch (type) {
      case "select":
        return createFormatContext(HTML_MODE, props.value != null ? props.value : props.defaultValue);
      case "svg":
        return createFormatContext(SVG_MODE, null);
      case "math":
        return createFormatContext(MATHML_MODE, null);
      case "foreignObject":
        return createFormatContext(HTML_MODE, null);
      case "table":
        return createFormatContext(HTML_TABLE_MODE, null);
      case "thead":
      case "tbody":
      case "tfoot":
        return createFormatContext(HTML_TABLE_BODY_MODE, null);
      case "colgroup":
        return createFormatContext(HTML_COLGROUP_MODE, null);
      case "tr":
        return createFormatContext(HTML_TABLE_ROW_MODE, null);
    }
    if (parentContext.insertionMode >= HTML_TABLE_MODE) return createFormatContext(HTML_MODE, null);
    return parentContext;
  }

  function pushStartInstance(type, props, formatContext) {
    switch (type) {
      case "select":
        return pushStartSelect(props);
      case "option":
        return pushStartOption(props, formatContext);
      case "textarea":
        return pushStartTextArea(props);
      case "input":
        return pushInput(props);
      case "menuitem":
        return pushStartMenuItem(props);
      case "title":
        return pushStartTitle(props);
      case "listing":
      case "pre":
        return pushStartPreformattedElement(props, type);
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "img":
      case "keygen":
      case "link":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
        return pushSelfClosing(props, type);
      case "annotation-xml":
      case "color-profile":
      case "font-face":
      case "font-face-src":
      case "font-face-uri":
      case "font-face-format":
      case "font-face-name":
      case "missing-glyph":
        return pushStartGenericElement(props, type);
      case "html":
        // Legacy renderToString starts in HTML_MODE, so no doctype is emitted.
        return pushStartGenericElement(props, type);
      default:
        if (type.indexOf("-") === -1 && typeof props.is !== "string") {
          return pushStartGenericElement(props, type);
        }
        return pushStartCustomElement(props, type);
    }
  }

  function pushEndInstance(type) {
    switch (type) {
      case "area":
      case "base":
      case "br":
      case "col":
      case "embed":
      case "hr":
      case "img":
      case "input":
      case "keygen":
      case "link":
      case "meta":
      case "param":
      case "source":
      case "track":
      case "wbr":
        return "";
      default:
        return "</" + type + ">";
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering (ReactFizzServer, synchronous subset)

  // The state of the render in progress. Every function that changes a field restores it before it
  // returns, except lastText, which is the result state of the text separator protocol.
  var state = null;
  // Marks "the text state at the start of an item of an array of unknown length".
  var UNKNOWN_TEXT_STATE = { unknownTextState: true };

  function readContext(context) {
    return state.contextValues[context._ssrIndex];
  }

  function pushTextInstance(text) {
    if (text === "") return "";
    var embedded = state.lastText;
    if (embedded === UNKNOWN_TEXT_STATE) {
      HOST.bail("a text node at the start of an item of an array of unknown length is not supported");
    }
    state.lastText = true;
    return (embedded ? "<!-- -->" : "") + escapeTextForBrowser(text);
  }

  function pushNumberInstance(number) {
    var embedded = state.lastText;
    if (embedded === UNKNOWN_TEXT_STATE) {
      HOST.bail("a text node at the start of an item of an array of unknown length is not supported");
    }
    state.lastText = true;
    // The decimal representation of a number never contains characters that need escaping.
    return (embedded ? "<!-- -->" : "") + number;
  }

  // A child about whose type nothing is known: the generated code renders it if it is a string,
  // number, boolean, null or undefined, and throws otherwise (it never renders it differently).
  function renderUnknownChild(node) {
    var embedded = state.lastText;
    if (embedded === UNKNOWN_TEXT_STATE) {
      HOST.bail("a child of unknown type at the start of an item of an array of unknown length is not supported");
    }
    var html = HOST.strT2(__ssrRenderPrimitiveChild, node, embedded);
    state.lastText = HOST.boolT2(__ssrIsTextChild, node, embedded);
    return html;
  }

  function renderNode(node) {
    if (HOST.isAbstract(node)) {
      var parts = HOST.condParts(node);
      if (parts !== undefined) {
        if (parts[0]) return renderNode(parts[1]);
        return renderNode(parts[2]);
      }
      var types = HOST.types(node);
      if (types === "string") return pushTextInstance(node);
      if (types === "number") return pushNumberInstance(node);
      if (types === "boolean" || types === "null" || types === "undefined") return "";
      return renderUnknownChild(node);
    }
    if (typeof node === "object" && node !== null) {
      switch (node.$$typeof) {
        case REACT_ELEMENT_TYPE:
          return renderElement(node.type, node.props, node.ref);
        case REACT_PORTAL_TYPE:
          throw new Error(
            "Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render."
          );
        case REACT_LAZY_TYPE:
          return renderNode(node._init(node._payload));
        case SSR_MAPPED_CHILDREN:
          return renderAbstractArray(node.array, node.fn);
      }
      if (isArray(node)) {
        if (HOST.isAbstract(node.length)) return renderAbstractArray(node, undefined);
        return renderChildrenArray(node);
      }
      var iteratorFn = getIteratorFn(node);
      if (iteratorFn) {
        var iterator = iteratorFn.call(node);
        if (iterator) {
          var step = iterator.next();
          if (!step.done) {
            var children = [];
            do {
              children.push(step.value);
              step = iterator.next();
            } while (!step.done);
            return renderChildrenArray(children);
          }
          return "";
        }
      }
      var childString = Object.prototype.toString.call(node);
      throw new Error(
        "Objects are not valid as a React child (found: " +
          (childString === "[object Object]" ? "object with keys {" + Object.keys(node).join(", ") + "}" : childString) +
          "). If you meant to render a collection of children, use an array instead."
      );
    }
    if (typeof node === "string") return pushTextInstance(node);
    if (typeof node === "number") return pushNumberInstance(node);
    return "";
  }

  function getIteratorFn(maybeIterable) {
    if (maybeIterable === null || typeof maybeIterable !== "object") return null;
    var maybeIterator = maybeIterable[Symbol.iterator] || maybeIterable["@@iterator"];
    if (typeof maybeIterator === "function") return maybeIterator;
    return null;
  }

  function renderChildrenArray(children) {
    var totalChildren = children.length;
    var html = "";
    for (var i = 0; i < totalChildren; i++) {
      var prevTreeContext = state.tree;
      state.tree = pushTreeContext(prevTreeContext, totalChildren, i);
      html += renderNode(children[i]);
      state.tree = prevTreeContext;
    }
    return html;
  }

  // Renders the children `array.map(fn)` (or `array` itself if fn is undefined) where the length of
  // array is unknown. The item renderer is specialized once for an abstract item and emitted as the
  // callback of a residual `array.map(...).join("")`. The callback restores all render state it
  // changes, so it has no net effect on the state (which Prepack requires of such callbacks). The
  // text separator state after an item must not depend on the item, see below.
  function renderAbstractArray(abstractArray, fn) {
    var array = HOST.widen(abstractArray);
    if (array === undefined) HOST.bail("cannot iterate over an array of unknown length here");
    var totalChildren = array.length;
    var before = state.lastText;
    var html = array
      .map(function (item, index) {
        var prevTreeContext = state.tree;
        var prevText = state.lastText;
        state.tree = pushTreeContext(prevTreeContext, totalChildren, index);
        state.lastText = UNKNOWN_TEXT_STATE;
        var itemHtml = renderNode(fn === undefined ? item : fn(item, index, array));
        var after = state.lastText;
        state.tree = prevTreeContext;
        state.lastText = prevText;
        // An item that ends in a text node would change the separator state seen by the next item.
        if (after !== false && after !== UNKNOWN_TEXT_STATE) {
          HOST.bail("an item of an array of unknown length that ends with a text node is not supported");
        }
        return itemHtml;
      })
      .join("");
    // Each item either ends with an element (state false) or rendered nothing (state unchanged).
    if (before !== false) {
      HOST.bail("an array of unknown length directly after a text node is not supported");
    }
    state.lastText = false;
    return html;
  }

  function renderHostElement(type, props) {
    var start = pushStartInstance(type, props, state.formatContext);
    state.lastText = false;
    var prevContext = state.formatContext;
    state.formatContext = getChildFormatContext(prevContext, type, props);
    var inner = renderNode(start.children);
    state.formatContext = prevContext;
    state.lastText = false;
    return start.html + inner + pushEndInstance(type);
  }

  function renderWithHooks(Component, props, secondArg) {
    var prevLocalIdCounter = localIdCounter;
    var prevRenderingComponent = renderingComponent;
    localIdCounter = 0;
    renderingComponent = true;
    var children = Component(props, secondArg);
    var hasId = localIdCounter !== 0;
    localIdCounter = prevLocalIdCounter;
    renderingComponent = prevRenderingComponent;
    return { children: children, hasId: hasId };
  }

  function renderWithIdContext(result) {
    if (result.hasId) {
      var prevTreeContext = state.tree;
      state.tree = pushTreeContext(prevTreeContext, 1, 0);
      var html = renderNode(result.children);
      state.tree = prevTreeContext;
      return html;
    }
    return renderNode(result.children);
  }

  function renderFunctionComponent(Component, props) {
    if (Component.contextTypes) HOST.bail("legacy context (contextTypes) is not supported");
    var result = renderWithHooks(Component, props, undefined);
    var value = result.children;
    if (typeof value === "object" && value !== null && typeof value.render === "function" && value.$$typeof === undefined) {
      HOST.bail("module pattern components are not supported");
    }
    return renderWithIdContext(result);
  }

  function renderClassComponent(ctor, props) {
    if (ctor.contextTypes || ctor.childContextTypes) HOST.bail("legacy context is not supported");
    var contextType = ctor.contextType;
    var context = typeof contextType === "object" && contextType !== null ? readContext(contextType) : {};
    var instance = new ctor(props, context);
    var initialState = instance.state !== null && instance.state !== undefined ? instance.state : null;
    instance.updater = classUpdater;
    instance.props = props;
    instance.state = initialState;
    instance.context = context;
    instance.refs = {};
    var getDerivedStateFromProps = ctor.getDerivedStateFromProps;
    if (typeof getDerivedStateFromProps === "function") {
      var partialState = getDerivedStateFromProps(props, initialState);
      instance.state =
        partialState === null || partialState === undefined ? initialState : Object.assign({}, initialState, partialState);
    }
    if (
      typeof getDerivedStateFromProps !== "function" &&
      typeof instance.getSnapshotBeforeUpdate !== "function" &&
      (typeof instance.UNSAFE_componentWillMount === "function" || typeof instance.componentWillMount === "function")
    ) {
      HOST.bail("componentWillMount is not supported");
    }
    var prevRenderingComponent = renderingComponent;
    renderingComponent = true;
    var nextChildren = instance.render();
    renderingComponent = prevRenderingComponent;
    if (typeof instance.getChildContext === "function") HOST.bail("legacy context (getChildContext) is not supported");
    return renderNode(nextChildren);
  }

  function resolveDefaultProps(Component, baseProps) {
    if (Component && Component.defaultProps) {
      var props = Object.assign({}, baseProps);
      var defaultProps = Component.defaultProps;
      for (var propName in defaultProps) {
        if (props[propName] === undefined) props[propName] = defaultProps[propName];
      }
      return props;
    }
    return baseProps;
  }

  function renderElement(type, props, ref) {
    if (typeof type === "function") {
      if (type.prototype && type.prototype.isReactComponent) return renderClassComponent(type, props);
      return renderFunctionComponent(type, props);
    }
    if (typeof type === "string") return renderHostElement(type, props);
    switch (type) {
      case REACT_LEGACY_HIDDEN_TYPE:
      case REACT_DEBUG_TRACING_MODE_TYPE:
      case REACT_STRICT_MODE_TYPE:
      case REACT_PROFILER_TYPE:
      case REACT_FRAGMENT_TYPE:
      case REACT_SUSPENSE_LIST_TYPE:
        return renderNode(props.children);
      case REACT_SCOPE_TYPE:
        throw new Error("ReactDOMServer does not yet support scope components.");
      case REACT_SUSPENSE_TYPE:
        HOST.bail("Suspense boundaries are not supported by the specializing server renderer");
    }
    if (typeof type === "object" && type !== null) {
      switch (type.$$typeof) {
        case REACT_FORWARD_REF_TYPE:
          return renderWithIdContext(renderWithHooks(type.render, props, ref));
        case REACT_MEMO_TYPE:
          return renderElement(type.type, resolveDefaultProps(type.type, props), ref);
        case REACT_PROVIDER_TYPE: {
          var index = type._context._ssrIndex;
          var prevValue = state.contextValues[index];
          state.contextValues[index] = props.value;
          var html = renderNode(props.children);
          state.contextValues[index] = prevValue;
          return html;
        }
        case REACT_CONTEXT_TYPE: {
          var render = props.children;
          return renderNode(render(readContext(type)));
        }
        case REACT_LAZY_TYPE:
          HOST.bail("React.lazy is not supported by the specializing server renderer");
      }
    }
    throw new Error(
      "Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: " +
        (type == null ? type : typeof type) +
        "."
    );
  }

  function renderToString(element) {
    var prevState = state;
    var contextValues = [];
    for (var i = 0; i < contexts.length; i++) contextValues.push(contexts[i]._currentValue2);
    state = {
      tree: { id: 1, overflow: "" },
      lastText: false,
      formatContext: createFormatContext(HTML_MODE, null),
      contextValues: contextValues,
    };
    var html = renderNode(element);
    state = prevState;
    return html;
  }

  var React = {
    Children: Children,
    Component: Component,
    PureComponent: PureComponent,
    Fragment: REACT_FRAGMENT_TYPE,
    StrictMode: REACT_STRICT_MODE_TYPE,
    Profiler: REACT_PROFILER_TYPE,
    Suspense: REACT_SUSPENSE_TYPE,
    SuspenseList: REACT_SUSPENSE_LIST_TYPE,
    cloneElement: cloneElement,
    createContext: createContext,
    createElement: createElement,
    createRef: createRef,
    forwardRef: forwardRef,
    isValidElement: isValidElement,
    lazy: lazy,
    memo: memo,
    startTransition: function (scope) {
      scope();
    },
    useCallback: useCallback,
    useContext: useContext,
    useDebugValue: noop,
    useDeferredValue: useDeferredValue,
    useEffect: noop,
    useId: useId,
    useImperativeHandle: noop,
    useInsertionEffect: noop,
    useLayoutEffect: noop,
    useMemo: useMemo,
    useMutableSource: useMutableSource,
    useReducer: useReducer,
    useRef: useRef,
    useState: useState,
    useSyncExternalStore: useSyncExternalStore,
    useTransition: useTransition,
    version: "18.3.1",
  };

  return { React: React, renderToString: renderToString, mapChildren: mapChildren };
})(__SSR_HOST);
