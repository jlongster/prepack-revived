// Contents panel, reading progress and the current section name in the top bar.
(function () {
  "use strict";
  var button = document.querySelector(".toc-button");
  var panel = document.getElementById("toc-panel");
  var label = document.querySelector(".topbar-section");
  var bar = document.querySelector(".progress span");

  function setOpen(open) {
    button.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
  }
  button.addEventListener("click", function () {
    setOpen(panel.hidden);
  });
  panel.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener("click", function (e) {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== button) setOpen(false);
  });

  var heads = Array.prototype.slice.call(document.querySelectorAll(".part h2, .part h3[id]"));
  var links = {};
  Array.prototype.forEach.call(panel.querySelectorAll("a"), function (a) {
    links[a.getAttribute("href").slice(1)] = a;
  });

  var ticking = false;
  function update() {
    ticking = false;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    var current = null;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top < 120) current = heads[i];
      else break;
    }
    var part = current && current.closest(".part");
    var partTitle = part ? part.querySelector("h2").textContent : "";
    var text = current ? (current.tagName === "H2" ? partTitle : partTitle + " · " + current.textContent) : "";
    if (label.textContent !== text) label.textContent = text;
    Object.keys(links).forEach(function (id) {
      links[id].classList.remove("active");
    });
    if (current) {
      var id = current.tagName === "H2" ? part.id : current.id;
      if (links[id]) links[id].classList.add("active");
    }
  }
  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
})();
