/* Relay rounds. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var d = null, st = { project: "", pitch: "", ranks: {}, error: "", busy: false };

  function monthName(m) { return MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4); }
  function btn(label, onClick, cls, disabled) {
    var b = h("button", { class: "btn " + (cls || "btn-primary"), type: "button", text: label, disabled: disabled ? true : null });
    b.addEventListener("click", onClick);
    return b;
  }
  function signIn(text) { return h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/relay.html"), text: text }); }
  function load() { return BC.api("GET", "/api/relay").then(function (res) { if (!res.ok) { root.textContent = ""; root.appendChild(h("p", { class: "muted", text: BC.errorText("server_error") })); return; } d = res.data; st.ranks = {}; Object.keys(d.me.ranks).forEach(function (k) { st.ranks[k] = d.me.ranks[k]; }); render(); }); }
  function act(url, body) {
    st.busy = true; st.error = ""; render();
    return BC.api("POST", url, body || {}).then(function (res) {
      st.busy = false;
      if (!res.ok) {
        var e = res.data || {};
        st.error = {
          entry_closed: "Entry for this round has closed.", voting_closed: "Voting isn't open right now.", already_entered: "You've already entered this round, or that project is already in it.",
          not_an_entrant: "Only people who entered a project in this round can rank.", own_project: "You can't rank your own project.",
          repo_archived: "That repository is archived on GitHub, so it can't take pull requests. Unarchive it first.",
          listing_not_verified: "List that project again through List a project first, so its repository is verified.",
          not_maintainer: "You can only enter a project you maintain.",
          invalid_fields: e.fields && e.fields[0] === "pitch" ? "Say in a sentence or two what a month of help would get done (10 to 300 characters)." : "Choose a first, second and third place: three different projects."
        }[e.error] || BC.errorText(e.error);
        render();
        return false;
      }
      return load().then(function () { return true; });
    });
  }

  function entryCard(e, extra) {
    return h("div", { class: "relay-entry" + (e.winner ? " winner" : "") }, [
      h("span", { class: "relay-swatch", style: "background:" + (e.tone || "#4A4A52"), "aria-hidden": "true" }),
      h("div", { class: "c-grow" }, [
        h("p", { class: "relay-title" }, [h("a", { href: "project.html?id=" + encodeURIComponent(e.project_id), text: e.title }), e.mine ? h("span", { class: "pill amber", text: "Your project" }) : null, e.carried_over ? h("span", { class: "pill", text: "Carried over" }) : null]),
        h("p", { class: "muted", text: (e.kind === "Mod" ? "Mod for " + e.base_game : e.kind + " · " + e.genre) + " · @" + e.owner }),
        h("p", { text: e.pitch })
      ]),
      extra || null
    ]);
  }

  function stages() {
    var r = d.round, order = ["entry", "voting", "running", "review", "closed"];
    var at = r.status === "not_run" ? -1 : order.indexOf(r.status);
    var defs = [
      ["Entry", "Until " + BC.niceDate(r.entry_closes)], ["Vote", "Until " + BC.niceDate(r.vote_closes)],
      ["Contribute", "Until " + BC.niceDate(r.ends)], ["Review", "Until " + BC.niceDate(r.review_ends)], ["Recap", "Badges awarded"]
    ];
    return h("ol", { class: "steps", "aria-label": "Round stage" }, defs.map(function (s, i) {
      var state = at < 0 ? "todo" : i < at ? "done" : i === at ? "current" : "todo";
      return h("li", { "data-state": state, "aria-current": state === "current" ? "step" : null }, [
        h("span", { class: "num", text: (state === "done" ? "✓ " : "") + "Step " + (i + 1) }), h("span", { class: "label", text: s[0] }), h("span", { class: "num", text: s[1] })]);
    }));
  }

  function entryStage() {
    var r = d.round, me = d.me, out = [];
    var left = Math.max(0, r.min_entries - d.entries.length);
    out.push(h("p", { class: "muted", text: d.entries.length + " entered so far · entry closes at the end of " + BC.niceDate(r.entry_closes) + (left ? " · " + left + " more needed for the round to run" : "") }));
    if (!me.signed_in) {
      out.push(h("p", { class: "callout plain" }, [signIn("Sign in with GitHub"), " to enter a project you maintain."]));
    } else if (me.entry_id) {
      out.push(h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "✓" }), h("div", null, [
        h("p", null, [h("strong", { text: "You're in this round." })]),
        h("p", { text: "Ranking opens on " + BC.niceDate(r.entry_closes).replace(/^\d+/, String(Number(r.entry_closes.slice(8)) + 1)) + ". You'll rank three of the other projects." })])]));
      out.push(h("div", { class: "actions" }, [btn("Withdraw my entry", function () { act("/api/relay/withdraw"); }, "btn-ghost", st.busy)]));
    } else if (!me.projects.length) {
      out.push(h("p", { class: "callout plain" }, ["To enter, you need a project of your own listed on Brainchild. ", h("a", { href: "list.html", text: "List a project" }), "."]));
    } else {
      var sel = h("select", { class: "select", id: "relay-project" }, me.projects.map(function (p) { return h("option", { value: p.id, text: p.title }); }));
      if (st.project) sel.value = st.project; else st.project = me.projects[0].id;
      sel.addEventListener("change", function () { st.project = sel.value; });
      var pitch = h("textarea", { class: "textarea", id: "relay-pitch", rows: "3", maxlength: "300", placeholder: "e.g. finish worlds 4 and 5 and add a level select" });
      pitch.value = st.pitch; pitch.addEventListener("input", function () { st.pitch = pitch.value; });
      out.push(h("section", { class: "panel wizard" }, [
        h("h2", { text: "Nominate your project" }),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "relay-project", text: "Your project" }), sel]),
          h("div", { class: "field wide" }, [h("label", { for: "relay-pitch", text: "What would a month of help get done?" }), pitch, h("span", { class: "hint", text: "If you win, you'll post a task board for contributors. Everyone who enters is expected to open a pull request on the winner's project." })])
        ]),
        h("div", { class: "actions" }, [btn(st.busy ? "Entering…" : "Enter Relay round " + r.number, function () { act("/api/relay/enter", { project_id: st.project, pitch: st.pitch }).then(function (ok) { if (ok) st.pitch = ""; }); }, null, st.busy)])
      ]));
    }
    if (st.error) out.push(h("p", { class: "form-error", role: "alert", text: st.error }));
    out.push(h("h2", { text: "Entered so far" }));
    out.push(d.entries.length ? h("div", { class: "relay-list" }, d.entries.map(function (e) { return entryCard(e); })) : h("p", { class: "muted", text: "Nobody yet. Be the first." }));
    return out;
  }

  function voteStage() {
    var r = d.round, me = d.me, out = [];
    var entrant = !!me.entry_id, used = Object.keys(st.ranks).length;
    out.push(h("p", { class: "muted", text: d.entries.length + " projects entered · ranking closes at the end of " + BC.niceDate(r.vote_closes) + " · results appear after that" }));
    if (!me.signed_in) out.push(h("p", { class: "callout plain" }, [signIn("Sign in with GitHub"), " if you entered this round, to rank the other projects."]));
    else if (!entrant) out.push(h("p", { class: "callout plain", text: "Only people who entered a project in this round rank the others. Anyone can contribute to the winner once it's chosen." }));
    else out.push(h("p", { class: "callout plain", text: "Rank three projects other than your own: 1 is your first choice (3 points), then 2 (2 points) and 3 (1 point). " + (used === 3 ? "Ready to send." : "Pick " + (3 - used) + " more.") }));
    out.push(h("div", { class: "relay-list" }, d.entries.map(function (e) {
      if (!entrant) return entryCard(e);
      if (e.mine) return entryCard(e, h("span", { class: "muted", text: "Can't rank your own" }));
      var mineRank = st.ranks[e.id] || 0;
      return entryCard(e, h("div", { class: "relay-ranks", role: "group", "aria-label": "Rank " + e.title }, [1, 2, 3].map(function (n) {
        var b = h("button", { class: "chip", type: "button", "aria-pressed": mineRank === n ? "true" : "false", "aria-label": "Rank " + n, text: String(n) });
        b.addEventListener("click", function () {
          var next = {};
          Object.keys(st.ranks).forEach(function (k) { if (Number(k) !== e.id && st.ranks[k] !== n) next[k] = st.ranks[k]; });
          if (mineRank !== n) next[e.id] = n;
          st.ranks = next; render();
        });
        return b;
      })));
    })));
    if (entrant) {
      var saved = Object.keys(d.me.ranks).length === 3;
      if (st.error) out.push(h("p", { class: "form-error", role: "alert", text: st.error }));
      out.push(h("div", { class: "actions" }, [btn(st.busy ? "Saving…" : saved ? "Change my ranking" : "Send my ranking", function () {
        var picks = [1, 2, 3].map(function (n) { return Number(Object.keys(st.ranks).filter(function (k) { return st.ranks[k] === n; })[0]); });
        act("/api/relay/rank", { ranks: picks });
      }, null, st.busy || used !== 3), saved ? h("span", { class: "muted", role: "status", text: "Your ranking is saved. You can change it until voting closes." }) : null]));
    }
    return out;
  }

  function resultStage() {
    var r = d.round, w = d.entries.filter(function (e) { return e.winner; })[0], out = [];
    if (w) {
      out.push(h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "★" }), h("div", null, [
        h("p", { class: "eyebrow", text: "Round " + r.number + " winner" }),
        h("h2", null, [h("a", { href: "project.html?id=" + encodeURIComponent(w.project_id), text: w.title })]),
        h("p", { text: "Maintained by @" + w.owner + ". Goal for the month: " + w.pitch }),
        h("p", { class: "muted", text: "Ranked votes from " + (r.ranked_by || 0) + " of " + d.entries.length + " entrants · contributions are open until the end of " + BC.niceDate(r.ends) })])]));
    }
    out.push(h("h2", { text: "How the vote went" }));
    var sorted = d.entries.slice().sort(function (a, b) { return b.points - a.points || b.first_places - a.first_places || a.id - b.id; });
    out.push(h("div", { class: "relay-list" }, sorted.map(function (e) {
      return entryCard(e, h("span", { class: "relay-points", text: e.points + (e.points === 1 ? " point" : " points") + (e.first_places ? " · " + e.first_places + " first" : "") }));
    })));
    out.push(h("p", { class: "muted", text: "The task board, contributions and badges for this round are being built; this page will show them here." }));
    return out;
  }

  function notRun() {
    var r = d.round, next = new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)), 1)).toISOString().slice(0, 10);
    var out = [h("div", { class: "callout plain" }, [
      h("p", null, [h("strong", { text: "This month's round didn't run." })]),
      h("p", { text: "A round needs at least " + r.min_entries + " projects and " + d.entries.length + " entered by " + BC.niceDate(r.entry_closes) + ". " + (d.entries.length ? "Those entries are carried into the next round. " : "") + "Entry for the next round opens on " + BC.niceDate(next) + "." })])];
    if (d.entries.length) { out.push(h("h2", { text: "Carried into next month" })); out.push(h("div", { class: "relay-list" }, d.entries.map(function (e) { return entryCard(e); }))); }
    return out;
  }

  function render() {
    var r = d.round;
    document.getElementById("relay-eyebrow").textContent = "Relay round " + r.number + " · " + monthName(r.month) + " · opt-in";
    var parts = [stages()].concat(r.status === "entry" ? entryStage() : r.status === "voting" ? voteStage() : r.status === "not_run" ? notRun() : resultStage());
    root.textContent = "";
    parts.forEach(function (p) { if (p) root.appendChild(p); });
  }

  if (window.location.protocol === "file:") { root.textContent = "This page only works on the live site."; return; }
  load();
})();
