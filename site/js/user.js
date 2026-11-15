/* A member's public page: projects, Relay contributions and badges. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function monthName(m) { return MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4); }
  function message(parts) { root.textContent = ""; root.appendChild(h("p", { class: "muted" }, parts)); }
  function projectLink(id, title) { return h("a", { href: "project.html?id=" + encodeURIComponent(id), text: title }); }
  if (window.location.protocol === "file:") return message(["This page only works on the live site."]);
  var handle = (window.location.search.match(/[?&]u=([^&]+)/) || [])[1];
  try { handle = decodeURIComponent(handle || ""); } catch (e) { handle = ""; }
  if (!handle) return message(["No member chosen. ", h("a", { href: "browse.html", text: "Browse projects" }), "."]);
  BC.api("GET", "/api/users/" + encodeURIComponent(handle)).then(function (res) {
    if (res.status === 404) return message(["There is no member called @" + handle + "."]);
    if (!res.ok) return message([BC.errorText("server_error")]);
    var u = res.data, prs = u.relay.reduce(function (n, r) { return n + r.pull_requests; }, 0);
    document.title = "@" + u.handle + " · Brainchild";
    document.getElementById("u-name").textContent = "@" + u.handle;
    document.getElementById("u-sub").textContent = "Member since " + BC.niceDate(u.member_since) + " · " + prs + (prs === 1 ? " Relay contribution" : " Relay contributions");
    root.textContent = "";
    if (u.linked && u.linked.length) {
      root.appendChild(h("p", { class: "muted", text: "Also " + u.linked.map(function (x) { return "@" + x.handle + " on " + (x.provider === "github" ? "GitHub" : "GitLab"); }).join(" and ") + "." }));
    }
    root.appendChild(h("h2", { text: "Badges" }));
    root.appendChild(u.badges.length ? h("div", { class: "relay-list" }, u.badges.map(function (b) {
      return h("div", { class: "relay-entry" }, [h("div", { class: "c-grow" }, [
        h("p", { class: "relay-title" }, [h("span", { class: "pill amber", text: "★ " + b.label })]),
        h("p", { class: "muted" }, ["For work on ", projectLink(b.project_id, b.project_title), " · ", h("a", { href: "relay.html?month=" + encodeURIComponent(b.month), text: monthName(b.month) })])])]);
    })) : h("p", { class: "muted" }, ["No badges yet. Badges are awarded in ", h("a", { href: "relay.html", text: "Relay rounds" }), "."]));
    root.appendChild(h("h2", { text: "Relay contributions" }));
    root.appendChild(u.relay.length ? h("ul", { class: "relay-how" }, u.relay.map(function (r) {
      return h("li", null, [h("a", { href: "relay.html?month=" + encodeURIComponent(r.month), text: "Round " + r.number + " · " + monthName(r.month) }), " · " + r.pull_requests + (r.pull_requests === 1 ? " pull request for " : " pull requests for "), projectLink(r.project_id, r.project_title)]);
    })) : h("p", { class: "muted", text: "None yet." }));
    root.appendChild(h("h2", { text: "Projects they maintain" }));
    root.appendChild(u.projects.length ? h("ul", { class: "relay-how" }, u.projects.map(function (p) {
      return h("li", null, [projectLink(p.id, p.title), " · " + (p.kind === "Mod" ? "Made for " + p.base_game : p.kind + " · " + p.genre) + (p.platform ? " · on " + p.platform : "")]);
    })) : h("p", { class: "muted", text: "None listed." }));
  });
})();
