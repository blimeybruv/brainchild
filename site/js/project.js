window.BC.load(function () {
  var D = window.BC_DATA;
  var h = window.BC.h;
  var id = new URLSearchParams(window.location.search).get("id") || "moss-keeper";
  var item = D.items.filter(function (i) { return i.id === id; })[0] || D.items[0];
  var S = D.statuses[item.status];

  document.title = item.title + " · Brainchild";
  document.getElementById("crumb-title").textContent = item.title;
  document.getElementById("p-title").textContent = item.title;
  document.getElementById("p-sub").textContent = item.note;
  var badge = document.getElementById("p-badge");
  badge.textContent = S.label;
  badge.setAttribute("data-status", item.status);
  document.getElementById("p-cta").textContent = S.cta + " this project";
  document.getElementById("p-stage").style.background = item.tone;

  var playLabel = document.getElementById("p-play-label");
  var hint = document.getElementById("p-hint");
  if (item.kind === "Mod") {
    playLabel.textContent = "Download mod";
    hint.textContent = "[ needs " + item.game + " installed ]";
  } else if (!item.browser) {
    playLabel.textContent = "Download";
    hint.textContent = "[ no browser build yet ]";
  } else if (item.kind === "App") {
    playLabel.textContent = "Open in browser";
    hint.textContent = "[ app loads here ]";
  }

  var meta = document.getElementById("p-meta");
  [
    item.kind === "Mod" ? "Mod for " + item.game : item.genre,
    item.tech || null,
    item.kind === "Mod" ? "Source + install notes" : (item.browser ? "Built from source by Brainchild" : "Desktop or extension build")
  ].forEach(function (t) { if (t) meta.appendChild(h("span", { text: t })); });

  var details = document.getElementById("p-details");
  [
    ["Type", item.kind],
    ["License", item.license],
    [item.kind === "Mod" ? "Base game" : "Built with", item.kind === "Mod" ? item.game : (item.tech || "—")],
    ["AI tools", "[as tagged by maker]"],
    ["Repo", "[repo link]"]
  ].forEach(function (row) {
    details.appendChild(h("dt", { text: row[0] }));
    details.appendChild(h("dd", { text: row[1] }));
  });

  function lines(t) { return String(t).split(/\n+/).filter(Boolean); }

  function renderPacket(P) {
    // Handoff packet. Moss Keeper has a full sample; others show what the maker would fill in.
    var sample = id === "moss-keeper";
    var tabs = [
      { key: "works", label: "What works", body: function () {
        return P && P.works ? list(lines(P.works)) : sample ? list([
          "All 12 levels are playable start to finish; save/load works.",
          "Plant growth system is data-driven: new species are one JSON entry each.",
          "Build: open in Godot 4, export preset \"Web\" is already configured."
        ]) : h("p", { text: "[ The maker lists what's playable and how to build and run it. ]" });
      } },
      { key: "broken", label: "What's broken", body: function () {
        return P && P.broken ? list(lines(P.broken)) : sample ? list([
          "Level 9 can soft-lock if you undo during the water animation.",
          "Controller remapping UI is half-built (scene exists, not wired up).",
          "Tried: procedural islands. Dropped them; they felt lifeless. Notes in /docs/dead-ends.md."
        ]) : h("p", { text: "[ Known bugs, dead ends, and fixes already tried. ]" });
      } },
      { key: "vision", label: "What I was going for", body: function () {
        return h("p", { text: P && P.vision ? P.vision : sample
          ? "I wanted it to feel like tending a bonsai: slow, quiet, no fail states. The plan was 3 more biomes and a \"share your garden\" seed code. If you take it somewhere else entirely, that's fine too."
          : "[ The maker's vision: the feel, the endgame, what they'd build next. ]" });
      } },
      { key: "agent", label: "Agent context", body: function () {
        return h("pre", { class: "code-block", text: P && P.agent_context ? P.agent_context : sample
          ? "# CLAUDE.md\nGodot 4 project. Game logic in /scripts, levels in /levels/*.tres.\nGridManager owns all tile state; never mutate tiles from plant scripts.\nRun tests: godot --headless -s tests/run.gd\nStyle: small scenes, signals over direct references."
          : "# CLAUDE.md / AGENTS.md\n[ The maker's agent context file goes here. ]" });
      } },
      { key: "assets", label: "Asset provenance", body: function () {
        var rows = P && Array.isArray(P.provenance) && P.provenance.length
          ? P.provenance.map(function (x) { return [String(x.part || ""), String(x.how || "")]; })
          : sample
          ? [["Code", "AI-assisted, reviewed by hand. MIT."], ["Art", "Hand-drawn pixel art. CC BY 4.0."], ["Music", "[TOOL] generated, tagged per track. CC BY 4.0."]]
          : [["Code", "[ how it was made ]"], ["Art", "[ how it was made ]"], ["Audio", "[ how it was made ]"]];
        return h("div", { class: "prov-grid" }, rows.map(function (r) {
          return h("div", null, [h("strong", { text: r[0] }), h("span", { class: "muted", text: r[1] })]);
        }));
      } }
    ];

    function list(lines) {
      return h("ul", null, lines.map(function (l) { return h("li", { text: l }); }));
    }

    var tablist = document.getElementById("tabs");
    var panel = document.getElementById("tabpanel");
    var buttons = [];

    function select(i, focus) {
      buttons.forEach(function (b, j) {
        b.setAttribute("aria-selected", i === j ? "true" : "false");
        b.tabIndex = i === j ? 0 : -1;
      });
      panel.setAttribute("aria-labelledby", buttons[i].id);
      panel.textContent = "";
      panel.appendChild(tabs[i].body());
      if (focus) buttons[i].focus();
    }

    tabs.forEach(function (t, i) {
      var b = h("button", { type: "button", role: "tab", class: "tab", id: "tab-" + t.key, "aria-controls": "tabpanel", text: t.label });
      b.addEventListener("click", function () { select(i); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight") { e.preventDefault(); select((i + 1) % tabs.length, true); }
        if (e.key === "ArrowLeft") { e.preventDefault(); select((i - 1 + tabs.length) % tabs.length, true); }
      });
      buttons.push(b);
      tablist.appendChild(b);
    });
    select(0);
  }

  // Prefer the maker's packet from the database; fall back to the built-in sample.
  if (window.location.protocol === "file:") {
    renderPacket(null);
  } else {
    window.BC.getJSON("/api/projects/" + encodeURIComponent(item.id))
      .then(function (j) { renderPacket(j && j.packet); }, function () { renderPacket(null); });
  }
});
