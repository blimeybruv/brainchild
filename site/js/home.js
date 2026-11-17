window.BC.load(function () {
  var D = window.BC_DATA;
  var grid = document.getElementById("featured");
  var buttons = document.querySelectorAll("#home-filters .pill");
  var visible = D.items.filter(function (i) { return i.rating !== "mature" || window.BC.matureOk(); });
  // Featured listings; until any are featured, the newest ones.
  var featured = visible.filter(function (i) { return i.featured; });
  if (!featured.length) featured = visible.slice(0, 6);

  // The "CONTINUE?" card: a project up for adoption if there is one, otherwise a featured or the newest.
  var pick = visible.filter(function (i) { return i.status === "adopt"; })[0] || featured[0];
  var cc = document.getElementById("cc");
  if (pick && cc) {
    var h = window.BC.h, href = "project.html?id=" + encodeURIComponent(pick.id), S = D.statuses[pick.status] || { cta: "See" };
    var shot = document.getElementById("cc-shot");
    shot.style.background = pick.tone || "#4A4A52";
    if (pick.shot) shot.appendChild(h("img", { class: "shot-img", src: "/api/screenshots/" + pick.shot, alt: "", loading: "lazy" }));
    document.getElementById("cc-title").textContent = pick.title;
    document.getElementById("cc-meta").textContent = [pick.kind === "Mod" ? "Made for " + pick.game : pick.genre, pick.tech].filter(Boolean).join(" · ");
    var checks = document.getElementById("cc-checks");
    [pick.playUrl ? "Playable in the browser" : null, pick.license ? pick.license + " license" : null, pick.ownerVerified ? "Maintainer verified" : null, D.statuses[pick.status] ? D.statuses[pick.status].label : null]
      .filter(Boolean).forEach(function (t) { checks.appendChild(h("li", { text: t })); });
    var yes = document.getElementById("cc-yes");
    yes.textContent = "YES · " + S.cta.toLowerCase() + (pick.status === "adopt" ? " it" : "");
    yes.setAttribute("href", pick.status === "adopt" ? "adopt.html?id=" + encodeURIComponent(pick.id) : href);
    document.getElementById("cc-look").setAttribute("href", href);
    cc.hidden = false;
  }

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
