/* Homepage: when the Spectral contours background fades in, the headings marked .retype backspace
   and retype themselves in Chakra Petch; when it fades out, they do the same back to Bricolage
   Grotesque. Timing is read from the background's own CSS animation, so they can't drift apart.
   Screen readers get the plain text; visitors who prefer reduced motion see no typing. */
(function () {
  var layer = document.querySelector(".hx3");
  var els = document.querySelectorAll(".retype");
  if (!layer || !layer.getAnimations || !els.length) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var items = Array.prototype.map.call(els, function (el) {
    var typed = el.querySelector(".typed");
    return { el: el, typed: typed, caret: el.querySelector(".caret"), text: typed.textContent, hide: null };
  });
  var mono = false, busy = 0;

  // Keep each heading's height fixed so nothing below it jumps while it retypes.
  function reserve() {
    items.forEach(function (it) {
      it.el.style.minHeight = "";
      var a = it.el.offsetHeight; it.el.classList.toggle("mono");
      var b = it.el.offsetHeight; it.el.classList.toggle("mono");
      it.el.style.minHeight = Math.max(a, b) + "px";
    });
  }
  if (document.fonts && document.fonts.load) document.fonts.load('700 1em "Chakra Petch"').then(reserve, reserve); else reserve();
  window.addEventListener("resize", reserve);

  function cycle() {
    var list = layer.getAnimations();
    for (var i = 0; i < list.length; i++) if (list[i].animationName === "hero-cycle") return list[i];
    return null;
  }
  function retype(it, toMono) {
    busy++; clearTimeout(it.hide); it.caret.hidden = false;
    var text = it.text, n = text.length;
    (function back() {
      if (n > 0) { n--; it.typed.textContent = text.slice(0, n); return setTimeout(back, 28); }
      it.el.classList.toggle("mono", toMono);
      setTimeout(function fwd() {
        if (n < text.length) { n++; it.typed.textContent = text.slice(0, n); return setTimeout(fwd, text.charAt(n - 1) === "\n" ? 180 : 55); }
        busy--; it.hide = setTimeout(function () { it.caret.hidden = true; }, 3000);
      }, 350);
    })();
  }
  setInterval(function () {
    if (busy || document.hidden) return;
    var a = cycle(); if (!a) return;
    var p = a.effect.getComputedTiming().progress; // null before the layer's first turn
    var showing = p !== null && p >= 0.02 && p < 0.27;
    if (showing !== mono) { mono = showing; items.forEach(function (it) { retype(it, showing); }); }
  }, 200);
})();
