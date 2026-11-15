window.BC.load(function () {
  var D = window.BC_DATA;
  var h = window.BC.h;
  var store = window.BC.store;

  var posts = [
    { topic: "Community project", title: "Community project recap: Gutter Run got its missing levels", excerpt: "What the community finished in a month, what is still open, and how the original maker felt about it." },
    { topic: "Handoff story", title: "How Paper Knights found its second maintainer", excerpt: "The maker moved on, a player picked it up, and the agent context file did most of the explaining." },
    { topic: "Site news", title: "Mods are different: how mod listings work", excerpt: "Mods need their base game, so they get source downloads, install notes and version tags instead of a browser build." },
    { topic: "Guide", title: "Writing a handoff packet your successor will thank you for", excerpt: "Five sections, one license, and the one paragraph about your vision that people always skip." }
  ];
  var topics = ["All", "Community project", "Handoff story", "Guide", "Site news"];

  var topic = "All";
  var BC = window.BC;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var votes = null, voteError = "", reporting = 0, reported = {};
  // The categories that make sense for a proposal's text (the full list is on project pages).
  var REPORT_CATS = [["harass", "Harassment or hate"], ["spam", "Spam or junk"], ["sexual", "Sexual content"], ["other", "Something else"]];

  // Reporting a proposal's goal text. Signed out, the report form takes it, with this page's address.
  function reportBox(c) {
    if (reported[c.id]) return h("p", { class: "muted", role: "status", style: "margin:0;font-size:14px", text: "Thanks, your report is in. A moderator reviews every report." });
    if (!votes.signed_in) return h("a", { class: "chip", href: "report.html?url=" + encodeURIComponent(window.location.origin + "/blog.html"), text: "Report" });
    if (reporting !== c.id) {
      var open = h("button", { type: "button", class: "chip", text: "Report" });
      open.addEventListener("click", function () { reporting = c.id; renderCandidates(); });
      return open;
    }
    var cat = h("select", { class: "select", "aria-label": "What's wrong with this proposal?" }, [h("option", { value: "", text: "What's wrong?" })].concat(REPORT_CATS.map(function (x) { return h("option", { value: x[0], text: x[1] }); })));
    var details = h("textarea", { class: "textarea", rows: "2", maxlength: "1000", "aria-label": "Details (optional)", placeholder: "Details (optional)" });
    var err = h("p", { class: "form-error", role: "alert" });
    var send = h("button", { type: "button", class: "btn btn-primary", text: "Send report" });
    var cancel = h("button", { type: "button", class: "btn btn-ghost", text: "Cancel" });
    cancel.addEventListener("click", function () { reporting = 0; renderCandidates(); });
    send.addEventListener("click", function () {
      if (!cat.value) { err.textContent = "Choose what's wrong."; return; }
      send.disabled = true;
      BC.api("POST", "/api/reports", { proposal_id: c.id, category: cat.value, details: details.value }).then(function (res) {
        send.disabled = false;
        if (res.ok) { reported[c.id] = true; reporting = 0; renderCandidates(); return; }
        var e = res.data && res.data.error;
        err.textContent = e === "invalid_fields" ? "Please add some details." : e === "slow_down" ? "You've sent a lot of reports today. Try again tomorrow." : BC.errorText(e);
      });
    });
    return h("div", { class: "report-inline" }, [cat, details, err, h("div", { class: "actions" }, [send, cancel])]);
  }

  function loadVotes() {
    if (window.location.protocol === "file:") return renderCandidates();
    return BC.api("GET", "/api/votes").then(function (res) { votes = res.ok ? res.data : null; renderCandidates(); });
  }
  function signIn(text) { return h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/blog.html"), text: text }); }

  // This month's community project: the winner of the vote that closed at the end of last month.
  function renderCurrent() {
    var box = document.getElementById("current-project"), c = votes && votes.current;
    box.textContent = "";
    box.hidden = !c;
    if (!c) return;
    var name = MONTHS[Number(c.month.slice(5, 7)) - 1] + " " + c.month.slice(0, 4);
    var shot = c.shot ? h("img", { src: "/api/screenshots/" + c.shot, alt: "", loading: "lazy" }) : null;
    box.appendChild(h("div", { class: "current-inner" }, [
      h("div", { class: "shot", style: "background:" + (c.tone || "#4A4A52"), "aria-hidden": "true" }, shot ? [shot] : []),
      h("div", { class: "c-grow" }, [
        h("p", { class: "eyebrow", text: "Community project · " + name }),
        h("h2", { id: "current-h" }, [h("a", { href: "project.html?id=" + encodeURIComponent(c.project_id), text: c.title })]),
        h("p", { text: "The goal: " + c.goal }),
        h("p", { class: "muted", text: (c.kind === "Mod" ? "Mod for " + c.base_game + " · " : "") + "Proposed by @" + (c.proposed_by || "a member") + " · " +
          c.votes + " of " + c.voters + (c.voters === 1 ? " vote" : " votes") + " across " + c.proposals + (c.proposals === 1 ? " proposal" : " proposals") +
          (c.tied ? " · a tie, won by the proposal made first" : "") }),
        h("div", { class: "actions" }, [h("a", { class: "btn btn-light", href: "project.html?id=" + encodeURIComponent(c.project_id) + "#discussion", text: "Join in on the project page" })])
      ])
    ]));
  }

  // The monthly vote, from the database. One vote per person per month; it can be changed until the month ends.
  function renderCandidates() {
    renderCurrent();
    var wrap = document.getElementById("candidates");
    var status = document.getElementById("vote-status");
    wrap.textContent = "";
    status.textContent = "";
    if (!votes) { wrap.appendChild(h("p", { class: "muted", text: "The vote can't be loaded right now." })); return; }
    var name = MONTHS[Number(votes.month.slice(5, 7)) - 1];
    document.getElementById("vote-eyebrow").textContent = "Community project · voting closes " + BC.niceDate(votes.closes);
    document.getElementById("vote-h").textContent = "Pick " + name + "'s community project";
    if (!votes.proposals.length) {
      wrap.appendChild(h("p", { class: "muted", text: "Nothing has been proposed for " + name + " yet. Propose a project with the form on this page." }));
      return;
    }
    votes.proposals.forEach(function (c) {
      var on = votes.my_vote === c.id;
      var action;
      if (votes.signed_in) {
        action = h("button", { type: "button", class: on ? "btn btn-primary" : "btn btn-ghost", "aria-pressed": on ? "true" : "false", text: on ? "Your vote" : "Vote for this" });
        action.addEventListener("click", function () {
          action.disabled = true;
          BC.api("POST", "/api/votes", { proposal_id: on ? null : c.id }).then(function (res) {
            voteError = res.ok ? "" : BC.errorText(res.data && res.data.error);
            loadVotes();
          });
        });
      } else {
        action = h("p", { class: "muted", style: "margin:0;font-size:14px" }, [signIn("Sign in"), " to vote"]);
      }
      var withdraw = null;
      if (c.mine) {
        withdraw = h("button", { type: "button", class: "chip", text: "Withdraw my proposal" });
        withdraw.addEventListener("click", function () { BC.api("POST", "/api/proposals/" + c.id + "/delete", {}).then(loadVotes); });
      }
      wrap.appendChild(h("article", { class: "candidate" + (on ? " voted" : "") }, [
        h("div", { class: "shot", style: "background:" + (c.tone || "#4A4A52"), "aria-hidden": "true" }, [
          c.shot ? h("img", { class: "shot-img", src: "/api/screenshots/" + c.shot, alt: "", loading: "lazy" }) : h("span", { text: "[ screenshot ]" }),
          h("span", { class: "kind", text: c.kind })
        ]),
        h("h3", null, [h("a", { href: "project.html?id=" + encodeURIComponent(c.project_id), text: c.title })]),
        h("p", { class: "muted", style: "margin:0;font-size:14px", text: c.proposed_by ? "Proposed by @" + c.proposed_by : "Proposed by a member" }),
        h("p", { class: "goal", text: c.goal }),
        action, withdraw, c.mine ? null : reportBox(c)
      ]));
    });
    status.textContent = voteError || (votes.my_vote ? "Thanks, your vote is in. You can change it until voting closes." : "");
  }

  function renderPosts() {
    var bar = document.getElementById("topics");
    bar.textContent = "";
    topics.forEach(function (t) {
      var b = h("button", { type: "button", class: "pill", "aria-pressed": topic === t ? "true" : "false", text: t });
      b.addEventListener("click", function () {
        topic = t;
        renderPosts();
        document.querySelector('#topics [aria-pressed="true"]').focus();
      });
      bar.appendChild(b);
    });
    var list = document.getElementById("posts");
    list.textContent = "";
    posts.filter(function (p) { return topic === "All" || p.topic === topic; }).forEach(function (p) {
      list.appendChild(h("article", { class: "panel post" }, [
        h("div", { class: "byline" }, [
          h("span", { class: "topic", "data-topic": p.topic, text: p.topic }),
          h("span", { text: "by @[author] · [DATE]" })
        ]),
        h("h3", { text: p.title }),
        h("p", { text: p.excerpt }),
        h("span", { class: "muted", style: "font-size:14px", text: "Sample post: real posts come at launch." }) // no post pages yet; these samples go before launch
      ]));
    });
  }

  // Proposal form: projects up for adoption or open for collaboration.
  var sel = document.getElementById("proj");
  sel.appendChild(h("option", { value: "", text: "Choose a project…" }));
  D.items.filter(function (i) { return i.status === "adopt" || i.status === "help"; }).forEach(function (i) {
    sel.appendChild(h("option", { value: i.id, text: i.kind === "Mod" ? i.title + " (mod for " + i.game + ")" : i.title }));
  });
  var note = document.getElementById("propose-note");
  document.getElementById("propose").addEventListener("submit", function (e) {
    e.preventDefault();
    note.textContent = "";
    BC.api("POST", "/api/proposals", { project_id: sel.value, goal: document.getElementById("goal").value }).then(function (res) {
      if (res.ok) { e.target.reset(); note.textContent = "Thanks, your proposal is in the vote."; return loadVotes(); }
      var code = res.data && res.data.error;
      if (code === "not_signed_in") { note.textContent = ""; note.appendChild(signIn("Sign in")); note.appendChild(document.createTextNode(" to propose a project.")); return; }
      note.textContent = {
        invalid_fields: "Choose a project and describe the goal in a sentence or two (10 to 300 characters).",
        already_proposed: "That project has already been proposed for this vote.",
        too_many_proposals: "You can propose three projects a month.",
        not_up_for_adoption: "Only projects that are up for adoption or open for collaboration can be proposed."
      }[code] || BC.errorText(code);
    });
  });

  loadVotes();
  renderPosts();
});
