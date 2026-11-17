/* Relay rounds. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var d = null, st = { project: "", pitch: "", ranks: {}, error: "", errorAt: "", busy: false, task: { tag: "", title: "", detail: "" }, sub: { pr: "", task: "", note: "" }, flagOpen: 0, flag: { reason: "no_change", note: "" } };
  var month = (window.location.search.match(/[?&]month=(\d{4}-\d{2})/) || [])[1] || "";
  var FLAGS = { no_change: "No real change", spam: "Spam", no_effort: "Auto-generated with no effort", ignored: "Ignored the instructions" };

  function monthName(m) { return MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4); }
  function btn(label, onClick, cls, disabled) {
    var b = h("button", { class: "btn " + (cls || "btn-primary"), type: "button", text: label, disabled: disabled ? true : null });
    b.addEventListener("click", onClick);
    return b;
  }
  function signIn(text) { return h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/relay.html" + (month ? "?month=" + month : "")), text: text }); }
  function load() { return BC.api("GET", "/api/relay" + (month ? "?month=" + month : "")).then(function (res) { if (!res.ok) { root.textContent = ""; root.appendChild(h("p", { class: "muted" }, res.status === 404 ? ["There is no round for that month. ", h("a", { href: "relay.html", text: "See this month's round" }), "."] : [BC.errorText("server_error")])); return; } d = res.data; st.ranks = {}; Object.keys(d.me.ranks).forEach(function (k) { st.ranks[k] = d.me.ranks[k]; }); render(); }); }
  function act(url, body, where) {
    st.busy = true; st.error = ""; st.errorAt = where || ""; render();
    return BC.api("POST", url, body || {}).then(function (res) {
      st.busy = false;
      if (!res.ok) {
        var e = res.data || {};
        st.error = {
          entry_closed: "Entry for this round has closed.", voting_closed: "Voting isn't open right now.", already_entered: "You've already entered this round, or that project is already in it.",
          not_an_entrant: "Only people who entered a project in this round can rank.", own_project: "You can't rank your own project.",
          repo_archived: "That repository is archived, so it can't take pull requests. Unarchive it first.",
          listing_not_verified: "List that project again through List a project first, so its repository is verified.",
          not_maintainer: "You can only enter a project you maintain.",
          board_closed: "The task board is only open during the round's month.", contributions_closed: "This round is no longer taking contributions.",
          pr_not_found: "That pull request (or merge request) couldn't be found on the winning project. Check the link or number.", pr_wrong_repo: "That pull request isn't on the winning project's repository.",
          pr_not_yours: "That pull request was opened by a different account from the GitHub or GitLab account linked to your Brainchild account.",
          pr_outside_round: "That pull request wasn't opened during this round's month, so it can't count for this round.",
          already_submitted: "That pull request has already been submitted.", too_many: "That's the most this round allows.",
          already_flagged: "This contribution has been flagged, so it can't be changed now.",
          not_eligible: "You entered an earlier round and have no pull request that counts for its winner, so you can't nominate a project yet. Contribute to a round and you can enter the one after.",
          awards_not_open: "Badges are awarded once the month is over.", awards_closed: "The badges for this round are final.", already_awarded: "That badge has already been awarded.",
          own_contribution: "You can't award a badge to yourself.", not_counting: "A badge can only go to a pull request that counts.", not_a_wildcard: "Best wildcard can only go to a wildcard contribution.",
          invalid_fields: {
            pitch: "Say in a sentence or two what a month of help would get done (10 to 300 characters).",
            pr: d && d.board && d.board.repo_host === "gitlab" ? "Paste the link to your merge request, for example https://gitlab.com/group/project/-/merge_requests/12, or just its number." : "Paste the link to your pull request, for example https://github.com/owner/repo/pull/12.",
            note: where === "sub" ? "Say in a sentence or two what you tried and why (10 to 300 characters)." : "Keep the note under 500 characters.",
            title: "Give the task a title (5 to 120 characters).", tag: "Keep the label to 20 characters.", detail: "Keep the details under 500 characters.",
            task_id: "That task is no longer on the board. Choose another, or submit as a wildcard.", reason: "Choose a reason for the flag."
          }[e.fields && e.fields[0]] || "Choose a first, second and third place: three different projects."
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
        h("p", { class: "muted", text: (e.kind === "Mod" ? "Made for " + e.base_game : e.kind + " · " + e.genre) + " · @" + e.owner }),
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
      out.push(h("p", { class: "callout plain" }, [signIn("Sign in"), " to enter a project you maintain."]));
    } else if (me.entry_id) {
      out.push(h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "✓" }), h("div", null, [
        h("p", null, [h("strong", { text: "You're in this round." })]),
        h("p", { text: "Ranking opens on " + BC.niceDate(r.entry_closes).replace(/^\d+/, String(Number(r.entry_closes.slice(8)) + 1)) + ". You'll rank three of the other projects." })])]));
      out.push(h("div", { class: "actions" }, [btn("Withdraw my entry", function () { act("/api/relay/withdraw"); }, "btn-ghost", st.busy)]));
    } else if (me.eligible === false) {
      out.push(h("p", { class: "callout plain", text: "You entered the " + monthName(me.missed_month) + " round and have no pull request that counts for its winner, so you can't nominate a project this time. You don't need to enter to contribute, though: once this round's winner is chosen, a task board appears on this page. Open a pull request on the winner's project and you can enter the next round." }));
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
    if (!me.signed_in) out.push(h("p", { class: "callout plain" }, [signIn("Sign in"), " if you entered this round, to rank the other projects."]));
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

  function errAt(where) { return st.error && st.errorAt === where ? h("p", { class: "form-error", role: "alert", text: st.error }) : null; }
  function input(id, value, attrs, onInput) {
    var el = h("input", Object.assign({ class: "input", id: id, type: "text" }, attrs));
    el.value = value; el.addEventListener("input", function () { onInput(el.value); });
    return el;
  }
  function area(id, value, attrs, onInput) {
    var el = h("textarea", Object.assign({ class: "textarea", id: id, rows: "3" }, attrs));
    el.value = value; el.addEventListener("input", function () { onInput(el.value); });
    return el;
  }

  // The winner's task board: tasks, who is working on what, and the wildcard.
  function boardSection() {
    var r = d.round, b = d.board, me = d.me, out = [];
    out.push(h("h2", { id: "task-board", text: "Task board" }));
    out.push(h("p", { class: "muted", text: "Posted by @" + b.maintainer + ". Say what you're working on, so people don't spend their time (or AI usage) on the same thing." }));
    if (BC.artNotice(b.assets_license)) out.push(h("p", { class: "callout plain art-notice", text: BC.artNotice(b.assets_license) }));
    var cards = b.tasks.map(function (t) {
      var who = t.claimed_by.length ? t.claimed_by.map(function (x) { return "@" + x; }).join(", ") + (t.claimed_by.length === 1 ? " is" : " are") + " working on this" : "Nobody has taken this yet";
      var control = null;
      if (b.open && me.maintainer) control = btn("Remove", function () { act("/api/relay/tasks/" + t.id + "/remove", {}, "board"); }, "btn-ghost", st.busy);
      else if (b.open && me.signed_in) control = btn(t.claimed ? "Stop working on this" : "I'm working on this", function () { act("/api/relay/tasks/" + t.id + (t.claimed ? "/unclaim" : "/claim"), {}, "board"); }, t.claimed ? "btn-ghost" : "btn-light", st.busy);
      return h("div", { class: "relay-entry" }, [h("div", { class: "c-grow" }, [
        h("p", { class: "relay-title" }, [h("span", { class: "pill", text: t.tag }), t.title]),
        t.detail ? h("p", { text: t.detail }) : null,
        h("p", { class: "muted", text: who })]), control]);
    });
    if (!b.tasks.length) out.push(h("p", { class: "callout plain", text: b.open ? "No tasks posted yet. The maintainer has until the end of " + BC.niceDate(r.tasks_due) + " to post them. A wildcard is welcome in the meantime." : "The maintainer didn't post any tasks, so every contribution to this round was a wildcard." }));
    cards.push(h("div", { class: "relay-entry" }, [h("div", { class: "c-grow" }, [
      h("p", { class: "relay-title" }, [h("span", { class: "pill amber", text: "Wildcard" }), "Got your own idea? Go for it."]),
      h("p", { class: "muted", text: "Explain what you tried and why when you submit." })])]));
    out.push(h("div", { class: "relay-list" }, cards));
    out.push(errAt("board"));
    if (b.open && me.maintainer) {
      out.push(h("section", { class: "panel wizard" }, [
        h("h3", { text: "Add a task" }),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "task-tag", text: "Label" }), input("task-tag", st.task.tag, { maxlength: "20", placeholder: "e.g. Bug, Art, Balance" }, function (v) { st.task.tag = v; })]),
          h("div", { class: "field" }, [h("label", { for: "task-title", text: "Task" }), input("task-title", st.task.title, { maxlength: "120", placeholder: "e.g. Plankton crash after day 40" }, function (v) { st.task.title = v; })]),
          h("div", { class: "field wide" }, [h("label", { for: "task-detail", text: "Details (optional)" }), area("task-detail", st.task.detail, { maxlength: "500", rows: "2" }, function (v) { st.task.detail = v; })])
        ]),
        errAt("task"),
        h("div", { class: "actions" }, [btn(st.busy ? "Adding…" : "Add task", function () { act("/api/relay/tasks", st.task, "task").then(function (ok) { if (ok) { st.task = { tag: "", title: "", detail: "" }; render(); } }); }, null, st.busy)])
      ]));
    }
    return out;
  }

  // Sending in a pull request, for everyone except the winning maintainer.
  function submitSection() {
    var r = d.round, b = d.board, me = d.me, out = [];
    if (!b.accepting) return out;
    if (!me.signed_in) { out.push(h("p", { class: "callout plain" }, [signIn("Sign in"), " to take a task or submit a pull request. Anyone can contribute, not only people who entered."])); return out; }
    if (me.maintainer) { out.push(h("p", { class: "callout plain", text: "This is your project's round. Contributions appear below as people submit them. Accept good-faith work even if you don't merge it; if one is junk, flag it with a reason and a moderator will review it." })); return out; }
    if (me.entry_id) {
      out.push(h("p", { class: "callout plain", text: me.contributed ? "Your pull request is in for this round. Thank you." : "You entered this round, so you're expected to open a pull request on " + b.project_title + " by the end of " + BC.niceDate(r.ends) + ". Without one, you can't nominate a project in the next round." }));
    }
    var sel = h("select", { class: "select", id: "sub-task" }, b.tasks.map(function (t) { return h("option", { value: String(t.id), text: t.tag + ": " + t.title }); }).concat([h("option", { value: "", text: "Wildcard: my own idea" })]));
    sel.value = st.sub.task; if (sel.value !== st.sub.task) { sel.value = ""; st.sub.task = ""; }
    sel.addEventListener("change", function () { st.sub.task = sel.value; });
    var glw = b.repo_host === "gitlab";
    var safeRepo = b.repo_url && /^https:\/\/(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|gitlab\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5})$/.test(b.repo_url);
    out.push(h("section", { class: "panel wizard" }, [
      h("h3", { text: "Submit your contribution to " + b.project_title }),
      h("p", { class: "muted" }, [glw ? "Open a merge request on " : "Open a pull request on ", safeRepo ? h("a", { href: b.repo_url, rel: "noopener noreferrer", target: "_blank", text: b.repo }) : (b.repo || "the project's repository"),
        " first, from " + (glw ? "the GitLab account linked to your Brainchild account" : "the GitHub account linked to your Brainchild account") + ". It has to be opened during " + monthName(r.month) + ". It doesn't have to be merged to count, only real."]),
      h("div", { class: "form-grid" }, [
        h("div", { class: "field wide" }, [h("label", { for: "sub-pr", text: glw ? "Merge request link" : "Pull request link" }), input("sub-pr", st.sub.pr, { maxlength: "300", placeholder: glw ? "https://gitlab.com/" + (b.repo || "group/project") + "/-/merge_requests/12" : "https://github.com/" + (b.repo || "owner/repo") + "/pull/12", inputmode: "url" }, function (v) { st.sub.pr = v; })]),
        h("div", { class: "field wide" }, [h("label", { for: "sub-task", text: "Task" }), sel]),
        h("div", { class: "field wide" }, [h("label", { for: "sub-note", text: "What did you try, and why? (one or two sentences)" }), area("sub-note", st.sub.note, { maxlength: "300" }, function (v) { st.sub.note = v; })])
      ]),
      errAt("sub"),
      h("div", { class: "actions" }, [btn(st.busy ? "Checking with GitHub…" : "Submit contribution", function () {
        act("/api/relay/contributions", { pr: st.sub.pr, task_id: st.sub.task ? Number(st.sub.task) : null, note: st.sub.note, month: r.month }, "sub").then(function (ok) { if (ok) { st.sub = { pr: "", task: "", note: "" }; render(); } });
      }, null, st.busy)])
    ]));
    return out;
  }

  function contributionRow(c) {
    var b = d.board, me = d.me;
    var safe = /^https:\/\/(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull|gitlab\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}\/-\/merge_requests)\/\d+$/.test(c.pr_url), mark = /\/merge_requests\//.test(c.pr_url) ? "!" : "#";
    var mineBadges = (d.badges || []).filter(function (x) { return x.contribution_id === c.id; });
    var parts = [
      h("p", { class: "relay-title" }, [userLink(c.user), h("span", { class: "pill" + (c.wildcard ? " amber" : ""), text: c.wildcard ? "Wildcard" : c.tag || "Task" }),
        mineBadges.length ? h("span", null, mineBadges.map(function (x) { return h("span", { class: "pill amber", text: "★ " + x.label }); })) : null,
        c.status === "under_review" ? h("span", { class: "pill", text: "Flagged · under review" }) : c.status === "not_counted" ? h("span", { class: "pill", text: "Doesn't count" }) : null,
        c.mine ? h("span", { class: "pill amber", text: "Yours" }) : null]),
      h("p", null, [safe ? h("a", { href: c.pr_url, rel: "noopener noreferrer", target: "_blank", text: mark + c.pr_number + " " + c.pr_title }) : mark + c.pr_number + " " + c.pr_title]),
      c.wildcard ? null : h("p", { class: "muted", text: "Task: " + (c.task || "removed from the board") }),
      h("p", { text: "\u201c" + c.note + "\u201d" })
    ];
    if (c.flag) {
      parts.push(h("p", { class: "muted", text: "Flagged by the maintainer: " + (FLAGS[c.flag.reason] || c.flag.reason) + "." + (c.flag.note ? " " + c.flag.note : "") + (c.flag.outcome ? "" : " A moderator will review it; until then it still counts.") }));
      if (c.flag.outcome) parts.push(h("p", null, [h("strong", { text: c.flag.outcome === "upheld" ? "A moderator agreed, so this pull request doesn't count. " : "A moderator reviewed the flag and cleared it. " }), c.flag.reasons || ""]));
    }
    var controls = [];
    if (b.accepting && c.mine && c.status === "counts" && !c.flag) controls.push(btn("Withdraw", function () { act("/api/relay/contributions/" + c.id + "/withdraw", {}, "c" + c.id); }, "btn-ghost", st.busy));
    if (b.accepting && me.maintainer && !c.flag) {
      if (st.flagOpen !== c.id) controls.push(btn("Flag as junk…", function () { st.flagOpen = c.id; st.flag = { reason: "no_change", note: "" }; st.error = ""; render(); }, "btn-ghost", st.busy));
      else {
        var why = h("select", { class: "select", "aria-label": "Reason for the flag" }, Object.keys(FLAGS).map(function (k) { return h("option", { value: k, text: FLAGS[k] }); }));
        why.value = st.flag.reason; why.addEventListener("change", function () { st.flag.reason = why.value; });
        parts.push(h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [why]),
          h("div", { class: "field wide" }, [input("flag-note-" + c.id, st.flag.note, { maxlength: "500", "aria-label": "Note for the moderator (optional)", placeholder: "Note for the moderator (optional)" }, function (v) { st.flag.note = v; })])]));
        parts.push(h("p", { class: "muted", text: "A flag isn't a penalty by itself. A moderator looks at the pull request and decides; the contributor is told the reasons." }));
        controls.push(btn("Send flag", function () { act("/api/relay/contributions/" + c.id + "/flag", st.flag, "c" + c.id).then(function (ok) { if (ok) { st.flagOpen = 0; render(); } }); }, null, st.busy));
        controls.push(btn("Cancel", function () { st.flagOpen = 0; render(); }, "btn-ghost", st.busy));
      }
    }
    // Badges: the maintainer during review, or a moderator afterwards if the maintainer awarded none.
    if (me.can_award && c.status === "counts" && !c.mine) {
      [["helpful", "Most helpful"], ["wildcard", "Best wildcard"]].forEach(function (k) {
        if (k[0] === "wildcard" && !c.wildcard) return;
        var has = mineBadges.some(function (x) { return x.kind === k[0]; });
        if (has && d.round.status !== "review") return;
        controls.push(btn(has ? "Take back " + k[1] : "Award " + k[1], function () { act("/api/relay/badges", { month: d.round.month, kind: k[0], contribution_id: has ? null : c.id }, "c" + c.id); }, has ? "btn-ghost" : "btn-light", st.busy));
      });
    }
    if (controls.length) parts.push(h("div", { class: "actions" }, controls));
    parts.push(errAt("c" + c.id));
    return h("div", { class: "relay-entry" }, [h("div", { class: "c-grow" }, parts)]);
  }

  function userLink(handle) { return h("a", { href: "user.html?u=" + encodeURIComponent(handle), text: "@" + handle }); }
  function names(list) { var out = []; list.forEach(function (x, i) { if (i) out.push(i === list.length - 1 ? " and " : ", "); out.push(userLink(x)); }); return out; }

  // After the month: what was done, who got the badges, and who missed.
  function recapSection() {
    var r = d.round, c = d.recap, me = d.me, out = [];
    out.push(h("h2", { text: "Relay round " + r.number + " recap" }));
    out.push(h("p", { text: c.pull_requests + (c.pull_requests === 1 ? " pull request" : " pull requests") + " from " + c.contributors + (c.contributors === 1 ? " contributor" : " contributors") + " for " + d.board.project_title + "." +
      (r.status === "review" ? " The maintainer is choosing badges until the end of " + BC.niceDate(r.review_ends) + "." : "") }));
    if (d.badges.length) {
      out.push(h("div", { class: "relay-list" }, d.badges.map(function (b) {
        return h("div", { class: "relay-entry" }, [h("div", { class: "c-grow" }, [
          h("p", { class: "relay-title" }, [h("span", { class: "pill amber", text: "★ " + b.label + " · Relay round " + r.number }), userLink(b.user)]),
          b.by_moderator ? h("p", { class: "muted", text: "Awarded by a moderator, because the maintainer awarded none." }) : r.status === "review" ? h("p", { class: "muted", text: "Picked by the maintainer. Final when review ends." }) : null])]);
      })));
    } else {
      out.push(h("p", { class: "muted", text: r.status === "review" ? "No badges picked yet." : "No badges were awarded for this round. The round still counts and contributors keep their credit." }));
    }
    if (me.can_award) out.push(h("p", { class: "callout plain", text: me.maintainer && r.status === "review"
      ? "Pick one Most helpful contributor and, if there's a wildcard worth it, one Best wildcard, using the buttons under Contributions. You can change your picks until review ends."
      : "The maintainer awarded no badges, so as a moderator you can award them using the buttons under Contributions. A moderator's award is final." }));
    if (c.under_review) out.push(h("p", { class: "muted", text: c.under_review + (c.under_review === 1 ? " contribution is" : " contributions are") + " flagged and waiting for a moderator. Nothing is held against a contributor in the meantime." }));
    if (c.missed.length) out.push(h("p", { class: "muted" }, [h("strong", { text: "Missed round: " })].concat(names(c.missed)).concat([(c.missed.length === 1 ? " has" : " have") + " no pull request that counts for this round, so can't nominate a project until they contribute to a later round."])));
    return out;
  }

  function resultStage() {
    var r = d.round, w = d.entries.filter(function (e) { return e.winner; })[0], out = [];
    if (w) {
      out.push(h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "★" }), h("div", null, [
        h("p", { class: "eyebrow", text: "Round " + r.number + " winner" }),
        h("h2", null, [h("a", { href: "project.html?id=" + encodeURIComponent(w.project_id), text: w.title })]),
        h("p", { text: "Maintained by @" + w.owner + ". Goal for the month: " + w.pitch }),
        h("p", { class: "muted", text: "Ranked votes from " + (r.ranked_by || 0) + " of " + d.entries.length + " entrants · " +
          (r.status === "running" ? "contributions are open until the end of " + BC.niceDate(r.ends) : r.status === "review" ? "the month is over; contributions are being reviewed until " + BC.niceDate(r.review_ends) : "this round has finished") })])]));
      if (r.status === "running" && d.board && !d.me.maintainer) {
        out.push(h("p", { class: "callout plain" }, [
          h("a", { class: "btn btn-primary", href: "#task-board", text: "Contribute to " + w.title }),
          " Anyone can contribute, whether or not they entered this round. A pull request that counts also makes you eligible to enter next month's round."]));
      }
    }
    if (d.board) {
      if (d.recap) out = out.concat(recapSection());
      out = out.concat(boardSection()).concat(submitSection());
      out.push(h("h2", { text: "Contributions" }));
      out.push(d.contributions.length ? h("div", { class: "relay-list" }, d.contributions.map(contributionRow)) : h("p", { class: "muted", text: "No pull requests submitted yet." }));
    }
    out.push(h("h2", { text: "How the vote went" }));
    var sorted = d.entries.slice().sort(function (a, b) { return b.points - a.points || b.first_places - a.first_places || a.id - b.id; });
    out.push(h("div", { class: "relay-list" }, sorted.map(function (e) {
      return entryCard(e, h("span", { class: "relay-points", text: e.points + (e.points === 1 ? " point" : " points") + (e.first_places ? " · " + e.first_places + " first" : "") +
        (e.contributed === true ? " · ✓ contributed" : e.contributed === false ? " · no pull request yet" : "") }));
    })));
    return out;
  }

  // Links to the other rounds that ran, so a round in review is still reachable next month.
  function otherRounds() {
    var others = (d.recent || []).filter(function (x) { return x.month !== d.round.month; });
    if (!others.length && d.round.current) return null;
    var S = { running: "contributions open", review: "in review", closed: "finished" };
    return h("div", null, [
      h("h2", { text: "Other rounds" }),
      h("ul", { class: "relay-how" }, (d.round.current ? [] : [h("li", null, [h("a", { href: "relay.html", text: "This month's round" })])]).concat(others.map(function (x) {
        return h("li", null, [h("a", { href: "relay.html?month=" + x.month, text: "Round " + x.number + " · " + monthName(x.month) }), " · " + (S[x.status] || x.status)]);
      })))
    ]);
  }

  function notRun() {
    var r = d.round, next = new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)), 1)).toISOString().slice(0, 10);
    var out = [h("div", { class: "callout plain" }, [
      h("p", null, [h("strong", { text: r.current ? "This month's round didn't run." : "The round for " + monthName(r.month) + " didn't run." })]),
      h("p", { text: "A round needs at least " + r.min_entries + " projects and " + d.entries.length + " entered by " + BC.niceDate(r.entry_closes) + ". " + (d.entries.length ? "Those entries " + (r.current ? "are" : "were") + " carried into the next round. " : "") + (r.current ? "Entry for the next round opens on " + BC.niceDate(next) + "." : "") })])];
    if (d.entries.length) { out.push(h("h2", { text: "Carried into next month" })); out.push(h("div", { class: "relay-list" }, d.entries.map(function (e) { return entryCard(e); }))); }
    return out;
  }

  function render() {
    var r = d.round;
    document.getElementById("relay-eyebrow").textContent = "Relay round " + r.number + " · " + monthName(r.month) + " · opt-in";
    var parts = [stages()].concat(r.status === "entry" ? entryStage() : r.status === "voting" ? voteStage() : r.status === "not_run" ? notRun() : resultStage());
    root.textContent = "";
    parts.push(otherRounds());
    parts.forEach(function (p) { if (p) root.appendChild(p); });
  }

  if (window.location.protocol === "file:") { root.textContent = "This page only works on the live site."; return; }
  load();
})();
