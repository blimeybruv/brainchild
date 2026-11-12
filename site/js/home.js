window.BC.load(function () {
  var D = window.BC_DATA;
  var grid = document.getElementById("featured");
  var buttons = document.querySelectorAll("#home-filters .pill");
  var featured = D.items.filter(function (i) { return i.featured; });

  function render(filter) {
    grid.textContent = "";
    featured
      .filter(function (i) {
        if (filter === "all") return true;
        if (filter === "browser") return !!i.browser;
        return i.kind === filter;
      })
      .forEach(function (i) { grid.appendChild(window.BC.card(i)); });
    if (!grid.children.length) {
      grid.appendChild(window.BC.h("p", { class: "muted", text: "Nothing featured in this category yet. Try Browse for the full list." }));
    }
  }

  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener("click", function () {
      Array.prototype.forEach.call(buttons, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render(b.getAttribute("data-filter"));
    });
  });
  render("all");

  // Little arcade touch: the CONTINUE? counter ticks down once, then holds.
  var cd = document.getElementById("countdown");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (cd && !reduce) {
    var n = 9;
    var t = setInterval(function () {
      n -= 1;
      cd.textContent = String(n);
      if (n <= 1) clearInterval(t);
    }, 1000);
  }
});
