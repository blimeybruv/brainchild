window.BC.load(function () {
  var D = window.BC_DATA;
  var h = window.BC.h;
  var id = new URLSearchParams(window.location.search).get("id") || "";
  var listed = D.items.filter(function (i) { return i.id === id; })[0];
  if (listed) return start(listed);
  // Not in the list we have (for example, published a moment ago): ask for it directly.
  if (!/^[a-z0-9-]{1,80}$/.test(id) || window.location.protocol === "file:") return missing();
  window.BC.getJSON("/api/projects/" + encodeURIComponent(id))
    .then(function (j) { if (j && j.project) start(window.BC.fromRow(j.project)); else missing(); }, missing);

  // No such project (or it was removed): say so instead of showing the page's empty frame.
  function missing() {
    document.title = "Project not found · Brainchild";
    document.getElementById("crumb-title").textContent = "Not found";
    document.getElementById("p-title").textContent = "That project isn't here";
    document.getElementById("p-sub").textContent = "It may have been removed, or the address is wrong.";
    var main = document.querySelector(".layout");
    if (main) {
      main.textContent = "";
      main.appendChild(h("p", { class: "muted" }, ["Have a look in ", h("a", { href: "browse.html", text: "Browse" }), " instead."]));
    }
    ["p-cta", "p-fork", "p-edit"].forEach(function (x) { var el = document.getElementById(x); if (el) el.hidden = true; });
  }

  function start(item) {
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

  // Mature projects open behind a notice listing their content notes. "Show it" lasts for the session.
  if (item.rating === "mature" && !window.BC.matureOk()) {
    var player = document.querySelector(".player");
    player.classList.add("gated");
    var notes = (item.notes || []).filter(function (n) { return n !== "Historical symbols"; });
    var show = h("button", { class: "btn btn-light", type: "button", text: "Show it" });
    var gate = h("div", { class: "mature-gate", role: "group", "aria-label": "Mature content warning" }, [
      h("span", { class: "badge", "data-status": "mature", text: "Mature" }),
      h("p", { class: "gate-title", text: "This project is rated Mature" }),
      h("p", { text: (notes.length ? "Contains: " + notes.join(", ").toLowerCase() + ". " : "") + "Mature means " + window.BC.RATINGS.mature.charAt(0).toLowerCase() + window.BC.RATINGS.mature.slice(1) }),
      h("p", { class: "muted", text: "The maker chose this rating; report the project if it's wrong." }),
      h("div", { class: "actions" }, [show, h("a", { class: "btn btn-ghost", href: "browse.html", text: "Go back" })])
    ]);
    show.addEventListener("click", function () { window.BC.setMatureOk(true); player.classList.remove("gated"); gate.remove(); });
    player.insertBefore(gate, player.firstChild);
  }

  var playLabel = document.getElementById("p-play-label");
  var hint = document.getElementById("p-hint");
  if (item.kind === "Mod") {
    playLabel.textContent = "Download";
    hint.textContent = "[ needs " + item.game + " installed ]";
  } else if (!item.browser) {
    playLabel.textContent = "Download";
    hint.textContent = "[ no browser build yet ]";
  } else if (item.kind === "App") {
    playLabel.textContent = "Open in browser";
    hint.textContent = "[ app loads here ]";
  }

  // Hosted builds aren't live yet (HANDOFF.md). Until they are, send people to the repo
  // instead of leaving a button that does nothing.
  var play = document.getElementById("p-play");
  if (item.repo && /^https:\/\/(github\.com|gitlab\.com)\//.test(item.repo)) {
    hint.textContent = "[ hosted build coming soon ]";
    playLabel.textContent = "Get it on " + item.repo.split("/")[2].replace(/\.(com|org)$/, "").replace(/^./, function (c) { return c.toUpperCase(); });
    play.addEventListener("click", function () { window.open(item.repo, "_blank", "noopener"); });
  } else {
    hint.textContent = "[ hosted build coming soon ]";
    play.disabled = true;
    play.title = "Not hosted yet";
  }

  var meta = document.getElementById("p-meta");
  [
    item.kind === "Mod" ? "Made for " + item.game : item.genre,
    item.tech || null,
    item.kind === "Mod" ? "Source + install notes" : (item.browser ? "Built from source by Brainchild" : "Desktop or extension build"),
    item.ncArt ? "Non-commercial art" : null
  ].forEach(function (t) { if (t) meta.appendChild(h("span", { text: t })); });

  var details = document.getElementById("p-details");
  [
    ["Type", window.BC.kindLabel(item.kind)],
    ["License", item.license],
    ["Art", item.assets ? (item.assets === "Same as the code" ? "Same license as the code" : item.assets) + (item.ncArt ? " (non-commercial: can be changed, not sold)" : "") : "—"],
    [item.kind === "Mod" ? "Made for" : "Built with", item.kind === "Mod" ? item.game : (item.tech || "—")],
    ["Repo", item.repo && /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9_.\/-]+$/.test(item.repo) ? h("a", { href: item.repo, rel: "noopener noreferrer", target: "_blank", text: item.repo.replace(/^https:\/\//, "") }) : "—"]
  ].forEach(function (row) {
    details.appendChild(h("dt", { text: row[0] }));
    details.appendChild(typeof row[1] === "string" ? h("dd", { text: row[1] }) : h("dd", null, [row[1]]));
  });

  function lines(t) { return String(t).split(/\n+/).filter(Boolean); }

  // Facts from the database: who owns it, the license record, the lineage, and how to adopt it.
  function renderRecord(p, lineage, packet) {
    var pid = encodeURIComponent(p.id);
    // "Before you adopt": what this listing really has, from the record.
    var checks = document.getElementById("p-checks");
    if (checks) {
      var k = packet || {}, filled = ["works", "broken", "vision", "agent_context"].filter(function (f) { return k[f] && String(k[f]).trim(); }).length + (Array.isArray(k.provenance) && k.provenance.length ? 1 : 0);
      var selfHosted = typeof p.repo_host === "string" && p.repo_host.indexOf("selfhosted:") === 0;
      [
        [!!p.license_record, p.license_record ? "License recorded: " + (p.license_record.spdx_id ? p.license_record.spdx_id + (p.license_record.detection === "with_note" ? ", with a note" : "")
          : p.license_record.detection === "conditions" ? "custom (" + p.license_record.base_spdx + " with added conditions)" : "custom license") : "No license record yet"],
        [!!p.play_url, p.play_url ? "Playable build hosted on Brainchild" : "No hosted build"],
        [filled === 5, "Handoff packet: " + (filled === 5 ? "all five sections filled" : filled + " of 5 sections filled")],
        [Array.isArray(k.provenance) && k.provenance.length > 0, Array.isArray(k.provenance) && k.provenance.length ? "Asset provenance noted" : "Asset provenance not noted"],
        [!!p.owner_verified, p.owner_verified ? (selfHosted ? "Maintainer verified: push access" : "Maintainer verified on " + (p.repo_host === "gitlab" ? "GitLab" : "GitHub")) : "Maintainer not verified"]
      ].forEach(function (c) { checks.appendChild(h("li", { class: c[0] ? null : "pending", text: c[1] })); });
    }
    // A custom license built on a standard one: the added conditions are shown where nobody can miss them.
    var lr = p.license_record, ln = document.getElementById("p-license-note");
    if (ln && lr && (lr.detection === "conditions" || lr.detection === "several")) {
      ln.textContent = "";
      ln.appendChild(h("div", { class: "callout bad license-note" }, [
        h("span", { class: "mark", "aria-hidden": "true", text: "!" }),
        h("div", null, lr.detection === "conditions" ? [
          h("p", null, [h("strong", { text: "Custom license: the " + lr.base_spdx + " text, with added conditions" })]),
          h("p", { text: "The maker says this wording in the license file adds to the standard " + lr.base_spdx + " terms. Read it before you use, change or adopt the project:" }),
          h("pre", { class: "code-block extra-wording", tabindex: "0", text: lr.extra_text || "" }),
          h("p", null, [h("a", { href: "license.html?id=" + pid, text: "Read the full license record" })])
        ] : [
          h("p", null, [h("strong", { text: "Custom license: more than one license text in one file (" + (lr.base_spdx || "") + ")" })]),
          h("p", null, ["Read which parts each covers in the ", h("a", { href: "license.html?id=" + pid, text: "license record" }), " before you use, change or adopt the project."])
        ])
      ]));
      ln.hidden = false;
    }
    // How fresh the packet is, and what has changed lately (field names only).
    if (packet && packet.updated_at) document.getElementById("p-packet-date").textContent = "· updated " + window.BC.niceDate(packet.updated_at);
    if (p.changes && p.changes.length) {
      var log = document.getElementById("p-changes");
      p.changes.slice(0, 8).forEach(function (c) { log.appendChild(h("li", null, [h("span", { class: "muted", text: window.BC.niceDate(c.at) + " · " }), c.fields.join(", ")])); });
      document.getElementById("p-changes-panel").hidden = false;
    }
    // Only the maintainer sees the Edit button; the server checks again on every save.
    window.BC.whoAmI().then(function (u) {
      var edit = document.getElementById("p-edit");
      if (u && u.handle === p.owner && p.owner_verified) { edit.setAttribute("href", "edit.html?id=" + pid); edit.hidden = false; }
    });
    document.dispatchEvent(new CustomEvent("bc:project", { detail: p })); // discussion.js adds screenshots
    // Where the main button goes: adopting has its own page; everything else happens on GitHub or
    // GitLab, or in the discussion when there is no repository to point to.
    var cta = document.getElementById("p-cta");
    var gh = p.repo_url && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(p.repo_url);
    var selfHosted = typeof p.repo_host === "string" && p.repo_host.indexOf("selfhosted:") === 0;
    var glab = p.repo_url && (selfHosted ? p.repo_url.indexOf("https://" + p.repo_host.slice(11) + "/") === 0 && /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}\/?$/.test(p.repo_url)
      : /^https:\/\/gitlab\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}\/?$/.test(p.repo_url));
    var repo = gh || glab ? p.repo_url.replace(/\/$/, "") : null;
    var forkUrl = repo ? repo + (glab ? "/-/forks/new" : "/fork") : null, issuesUrl = repo ? repo + (glab ? "/-/issues" : "/issues") : null;
    if (p.status === "adopt") cta.setAttribute("href", "adopt.html?id=" + pid);
    else if (p.status === "test" && p.play_url) cta.setAttribute("href", "#p-stage");
    else if (repo && p.status === "archived") { cta.setAttribute("href", forkUrl); cta.setAttribute("rel", "noopener"); }
    else if (repo && p.status !== "active") { cta.setAttribute("href", issuesUrl); cta.setAttribute("rel", "noopener"); }
    else if (repo) { cta.setAttribute("href", repo); cta.setAttribute("rel", "noopener"); }
    var fork = document.getElementById("p-fork");
    if (fork && repo) { fork.setAttribute("href", forkUrl); fork.setAttribute("rel", "noopener"); fork.hidden = false; }
    // The packet as one Markdown file, when the maker has written one.
    var dl = document.getElementById("p-packet-dl");
    if (dl && packet) { dl.setAttribute("href", "/api/projects/" + pid + "/packet.md"); dl.setAttribute("download", p.id + "-handoff-packet.md"); dl.hidden = false; }
    var by = document.getElementById("p-byline");
    if (by && p.owner) {
      by.textContent = (p.handed_off_at ? "Handed off " + window.BC.niceDate(p.handed_off_at) : "Listed " + window.BC.niceDate(p.created_at)) +
        " by @" + p.owner + (p.owner_verified ? (typeof p.repo_host === "string" && p.repo_host.indexOf("selfhosted:") === 0 ? " · ✓ verified: push access" : " · ✓ verified owner") : "") +
        (p.rating && p.rating !== "everyone" ? " · Rated " + (p.rating === "mature" ? "Mature" : "Teen") : "") +
        (p.content_notes && p.content_notes.length ? " (" + p.content_notes.join(", ").toLowerCase() + ")" : "");
    }
    if (p.license_record) {
      details.appendChild(h("dt", { text: "Record" }));
      details.appendChild(h("dd", null, [h("a", { href: "license.html?id=" + pid, text: "License record, commit " + String(p.license_record.commit_sha).slice(0, 7) })]));
    }
    var list = document.getElementById("p-lineage");
    if (list && lineage.length) {
      list.textContent = "";
      lineage.forEach(function (l) {
        var what = l.how === "forked" ? "Forked it" : l.how === "transferred" ? "Took over the repo" : l.role === "creator" ? "Created it" : "Maintainer";
        list.appendChild(h("li", null, [
          h("div", { class: "rail" }, [h("span", { class: "node", "aria-hidden": "true" }), h("span", { class: "line", "aria-hidden": "true" })]),
          h("div", null, [h("p", { class: "who", text: "@" + l.handle }),
            h("p", { class: "when", text: what + " · " + window.BC.niceDate(l.started_at) + (l.ended_at ? " to " + window.BC.niceDate(l.ended_at) : " to now") })])
        ]));
      });
      list.appendChild(h("li", null, [
        h("div", { class: "rail" }, [h("span", { class: "node next", "aria-hidden": "true" })]),
        h("div", null, [h("p", { class: "who next", text: p.status === "adopt" ? "You?" : "Collaborators welcome" }), h("p", { class: "when", text: p.status === "adopt" ? "Next maintainer" : "Join in on GitHub" })])
      ]));
    }
  }

  function renderPacket(P) {
    // Handoff packet: what the maker wrote, or a note where a section is still empty.
    var empty = function (what) { return h("p", { class: "muted", text: "Not filled in yet. " + what }); };
    var tabs = [
      { key: "works", label: "What works", body: function () {
        return P && P.works ? list(lines(P.works)) : empty("The maker lists what's playable and how to build and run it.");
      } },
      { key: "broken", label: "What's broken", body: function () {
        return P && P.broken ? list(lines(P.broken)) : empty("Known bugs, dead ends, and fixes already tried.");
      } },
      { key: "vision", label: "What I was going for", body: function () {
        return P && P.vision ? h("p", { text: P.vision }) : empty("The maker's vision: the feel, the endgame, what they'd build next.");
      } },
      { key: "agent", label: "Agent context", body: function () {
        return P && P.agent_context ? h("pre", { class: "code-block", text: P.agent_context }) : empty("The maker's CLAUDE.md or AGENTS.md goes here.");
      } },
      { key: "assets", label: "Asset provenance", body: function () {
        var rows = P && Array.isArray(P.provenance) && P.provenance.length
          ? P.provenance.map(function (x) { return [String(x.part || ""), String(x.how || "")]; }) : null;
        if (!rows) return empty("What was generated, with which tool, and what was made by hand.");
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

  // The maker's packet from the database.
  if (window.location.protocol === "file:") {
    renderPacket(null);
  } else {
    window.BC.getJSON("/api/projects/" + encodeURIComponent(item.id))
      .then(function (j) { renderPacket(j && j.packet); if (j && j.project) renderRecord(j.project, j.lineage || [], j.packet); }, function () { renderPacket(null); });
  }
  }
});
