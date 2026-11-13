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
  var votes = null, voteError = "";

  function loadVotes() {
    if (window.location.protocol === "file:") return renderCandidates();
    return BC.api("GET", "/api/votes").then(function (res) { votes = res.ok ? res.data : null; renderCandidates(); });
  }
  function signIn(text) { return h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/blog.html"), text: text }); }

  // The monthly vote, from the database. One vote per person per month; it can be changed until the month ends.
  function renderCandidates() {
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
        action, withdraw
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
        h("a", { href: "#", style: "align-self:flex-start;font-size:15px;font-weight:500", text: "Read the post" })
      ]));
    });
  }

  // Proposal form: fill the project list from listings that are up for adoption.
  var sel = document.getElementById("proj");
  sel.appendChild(h("option", { value: "", text: "Choose a project…" }));
  D.items.filter(function (i) { return i.status === "adopt"; }).forEach(function (i) {
    sel.appendChild(h("option", { value: i.id, text: i.kind === "Mod" ? i.title + " (mod for " + i.game + ")" : i.title }));
  });
  var note = document.getElementById("propose-note");
  document.getElementById("propose").addEventListener("submit", function (e) {
    e.preventDefault();
    note.textContent = "";
    BC.api("POST", "/api/proposals", { project_id: sel.value, goal: document.getElementById("goal").value }).then(function (res) {
      if (res.ok) { e.target.reset(); note.textContent = "Thanks, your proposal is in the vote."; return loadVotes(); }
      var code = res.data && res.data.error;
      if (code === "not_signed_in") { note.textContent = ""; note.appendChild(signIn("Sign in with GitHub")); note.appendChild(document.createTextNode(" to propose a project.")); return; }
      note.textContent = {
        invalid_fields: "Choose a project and describe the goal in a sentence or two (10 to 300 characters).",
        already_proposed: "That project has already been proposed for this vote.",
        too_many_proposals: "You can propose three projects a month.",
        not_up_for_adoption: "Only projects that are up for adoption can be proposed."
      }[code] || BC.errorText(code);
    });
  });

  loadVotes();
  renderPosts();
});
