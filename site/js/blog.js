window.BC.load(function () {
  var D = window.BC_DATA;
  var h = window.BC.h;
  var store = window.BC.store;

  var candidates = [
    { id: "signal-drift", goal: "Rebalance the economy and add a proper end boss. The design notes already sketch both." },
    { id: "tidepool", goal: "Pick one of the three directions in the vision doc and give the sim a goal." },
    { id: "freight-signals", goal: "Update it for the current OpenTTD release and write a proper install guide." }
  ].map(function (c) {
    var item = D.items.filter(function (i) { return i.id === c.id; })[0];
    return { id: c.id, goal: c.goal, title: item.title, kind: item.kind, tone: item.tone };
  });

  var posts = [
    { topic: "Community project", title: "Community project recap: Gutter Run got its missing levels", excerpt: "What the community finished in a month, what is still open, and how the original maker felt about it." },
    { topic: "Handoff story", title: "How Paper Knights found its second maintainer", excerpt: "The maker moved on, a player picked it up, and the agent context file did most of the explaining." },
    { topic: "Site news", title: "Mods are different: how mod listings work", excerpt: "Mods need their base game, so they get source downloads, install notes and version tags instead of a browser build." },
    { topic: "Guide", title: "Writing a handoff packet your successor will thank you for", excerpt: "Five sections, one license, and the one paragraph about your vision that people always skip." }
  ];
  var topics = ["All", "Community project", "Handoff story", "Guide", "Site news"];

  // Vote is remembered in this browser only (a real vote needs the backend).
  var vote = null;
  try { vote = store ? store.getItem("bc_vote") : null; } catch (e) { vote = null; }
  var topic = "All";

  function renderCandidates() {
    var wrap = document.getElementById("candidates");
    wrap.textContent = "";
    candidates.forEach(function (c) {
      var on = vote === c.id;
      var btn = h("button", { type: "button", class: on ? "btn btn-primary" : "btn btn-ghost", "aria-pressed": on ? "true" : "false", text: on ? "Your vote" : "Vote for this" });
      btn.addEventListener("click", function () {
        vote = on ? null : c.id;
        try { if (store) { if (vote) store.setItem("bc_vote", vote); else store.removeItem("bc_vote"); } } catch (e) {}
        renderCandidates();
      });
      wrap.appendChild(h("article", { class: "candidate" + (on ? " voted" : "") }, [
        h("div", { class: "shot", style: "background:" + c.tone, "aria-hidden": "true" }, [
          h("span", { text: "[ screenshot ]" }),
          h("span", { class: "kind", text: c.kind })
        ]),
        h("h3", { text: c.title }),
        h("p", { class: "muted", style: "margin:0;font-size:14px", text: "Proposed by @[member]" }),
        h("p", { class: "goal", text: c.goal }),
        btn
      ]));
    });
    document.getElementById("vote-status").textContent = vote ? "Thanks, your vote is in. You can change it until voting closes." : "";
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
  document.getElementById("propose").addEventListener("submit", function (e) {
    e.preventDefault();
    document.getElementById("propose-note").textContent = "Thanks! Proposals will be saved once accounts are live; this is a preview.";
    e.target.reset();
  });

  renderCandidates();
  renderPosts();
});
