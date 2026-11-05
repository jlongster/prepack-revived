// hard: P7
// source: new (React DOM VendorPrefix initialization pattern, cf. react-dom.development.js:6067)
// goal: handle canUseDOM + document.createElement('div').style + conditional delete + for-in + styleProp in style
// add at runtime:var window = this; var document = { createElement: function() { return { style: { WebkitAnimation: "" } }; } };
(function() {
  var canUseDOM = !!(
    typeof window !== "undefined" &&
    typeof window.document !== "undefined" &&
    typeof window.document.createElement !== "undefined"
  );
  var vendorPrefixes = {
    animationend: {
      animation: "animationend",
      WebkitAnimation: "webkitAnimationEnd",
      MozAnimation: "MozAnimationEnd",
    },
  };
  var style = {};
  if (canUseDOM) {
    style = document.createElement("div").style;
    if (!("AnimationEvent" in window)) {
      delete vendorPrefixes.animationend.animation;
    }
  }
  function getVendorPrefixedEventName(eventName) {
    var prefixMap = vendorPrefixes[eventName];
    for (var styleProp in prefixMap) {
      if (prefixMap.hasOwnProperty(styleProp) && styleProp in style) {
        return prefixMap[styleProp];
      }
    }
    return eventName;
  }
  global.TOP_ANIMATION_END = getVendorPrefixedEventName("animationend");
})();

inspect = function() {
  return global.TOP_ANIMATION_END;
};
