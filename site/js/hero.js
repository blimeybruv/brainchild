/* Homepage hero: when the Spectral contours background fades in, the headline backspaces and
   retypes itself in Chakra Petch; when it fades out, it does the same back to Bricolage Grotesque.
   Timing is read from the background's own CSS animation, so the two can't drift apart.
   Screen readers get the plain headline; visitors who prefer reduced motion see no typing. */
(function () {
  var h1 = document.getElementById("hero-title");
  var layer = document.querySelector(".hx3");
  if (!h1 || !layer || !layer.getAnimations) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var typed = h1.querySelector(".typed"), caret = h1.querySelector(".caret");
  var TEXT = "Hand it off,\nor take it on.";
  var mono = false, busy = false, hideTimer = null;

  // Keep the headline's height fixed so nothing below it jumps while it retypes.
  function reserve() {
    h1.style.minHeight = "";
    var a = h1.offsetHeight; h1.classList.toggle("mono");
    var b = h1.offsetHeight; h1.classList.toggle("mono");
    h1.style.minHeight = Math.max(a, b) + "px";
  }
  if (document.fonts && document.fonts.load) document.fonts.load('700 1em "Chakra Petch"').then(reserve, reserve); else reserve();
  window.addEventListener("resize", reserve);

  function cycle() {
    var list = layer.getAnimations();
    for (var i = 0; i < list.length; i++) if (list[i].animationName === "hero-cycle") return list[i];
    return null;
  }
  function retype(toMono) {
    busy = true; clearTimeout(hideTimer); caret.hidden = false;
    var text = TEXT, n = text.length;
    (function back() {
      if (n > 0) { n--; typed.textContent = text.slice(0, n); return setTimeout(back, 28); }
      h1.classList.toggle("mono", toMono); mono = toMono;
      setTimeout(function fwd() {
        if (n < text.length) { n++; typed.textContent = text.slice(0, n); return setTimeout(fwd, text.charAt(n - 1) === "\n" ? 180 : 55); }
        busy = false; hideTimer = setTimeout(function () { caret.hidden = true; }, 3000);
      }, 350);
    })();
  }
  setInterval(function () {
    if (busy || document.hidden) return;
    var a = cycle(); if (!a) return;
    var p = a.effect.getComputedTiming().progress; // null before the layer's first turn
    var showing = p !== null && p >= 0.02 && p < 0.27;
    if (showing !== mono) retype(showing);
  }, 200);
})();
