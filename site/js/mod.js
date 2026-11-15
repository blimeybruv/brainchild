/* Moderation queue. Only moderators get data from the API. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var CAT = { sexual: "Sexual content", rating: "Wrong rating", malware: "Malware or suspicious download", license: "License or copyright problem", harass: "Harassment or hate", spam: "Spam or junk", other: "Something else" };
  var view = "open";
  function message(text) { root.textContent = ""; root.appendChild(h("p", { class: "muted", text: text })); }
  function btn(label, cls, onClick) { var b = h("button", { class: "btn " + cls, type: "button", text: label }); b.addEventListener("click", onClick); return b; }
  var FLAGS = { no_change: "No real change", spam: "Spam", no_effort: "Auto-generated with no effort", ignored: "Ignored the instructions" };
  function prLink(url, number, title) {
    var label = "#" + number + (title ? " " + title : "");
    return /^https:\/\/(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull|gitlab\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}\/-\/merge_requests)\/\d+$/.test(url || "") ? h("a", { href: url, rel: "noopener noreferrer", target: "_blank", text: label }) : label;
  }
  function target(r) {
    var link = h("a", { href: "project.html?id=" + encodeURIComponent(r.project_id), text: r.project_title || r.project_id });
    if (r.target_type === "proposal") return [h("p", null, ["Blog proposal by @" + (r.proposal_author || r.affected || "someone") + " for ", link, r.proposal_month ? " (vote for " + r.proposal_month + ")" : "", r.proposal_removed ? " (already removed)" : ""]),
      h("blockquote", { class: "quote", text: r.proposal_goal || "[ no longer available ]" })];
    if (r.target_type === "relay_pr") return [h("p", null, ["Relay pull request by @" + (r.affected || "someone") + " for ", link, ": ", prLink(r.pr_url, r.pr_number), " (marked as junk: " + (FLAGS[r.category] || r.category) + ")"])];
    return r.target_type === "comment"
      ? [h("p", null, ["Comment by @" + (r.comment_author || r.affected || "someone") + " on ", link, r.comment_removed ? " (already removed)" : ""]), h("blockquote", { class: "quote", text: r.comment_body || "[ no longer available ]" })]
      : [h("p", null, ["Project: ", link, r.project_owner ? " by @" + r.project_owner : "", r.project_hidden ? " (already removed)" : ""])];
  }
  function reportItem(r) {
    var reasons = h("textarea", { class: "textarea", rows: "3", maxlength: "2000", "aria-label": "Reasons", placeholder: "For a removal: what it is, and which rule or law it breaks. The person affected will read this." });
    var ground = h("select", { class: "select", "aria-label": "Ground" }, [h("option", { value: "terms", text: "Breaks Brainchild's house rules" }), h("option", { value: "illegal", text: "Illegal content" })]);
    var err = h("p", { class: "form-error", role: "alert" });
    function send(decision) {
      err.textContent = "";
      BC.api("POST", "/api/mod/reports/" + r.id + "/resolve", { decision: decision, ground: ground.value, reasons: reasons.value }).then(function (res) {
        if (res.ok) return load();
        err.textContent = res.data.error === "invalid_fields" ? "A removal needs its reasons written out (at least a sentence)." : res.data.error === "already_resolved" ? "Someone already dealt with this report." : BC.errorText(res.data.error);
      });
    }
    return h("div", { class: "panel queue-item" }, [
      h("h3", { text: (CAT[r.category] || r.category) + " · reported by @" + r.reporter + " · " + BC.niceDate(r.created_at) })
    ].concat(target(r)).concat([
      r.details ? h("p", null, [h("strong", { text: "Reporter's details: " }), r.details]) : null,
      view === "open" ? h("div", { class: "form-grid" }, [h("div", { class: "field wide" }, [reasons]), h("div", { class: "field" }, [ground])]) : null,
      view === "open" ? h("div", { class: "actions" }, [btn("Remove it", "btn-primary", function () { send("remove"); }), btn("Dismiss the report", "btn-ghost", function () { send("dismiss"); })]) : h("p", { class: "muted", text: "Outcome: " + r.status + (r.resolved_at ? " on " + BC.niceDate(r.resolved_at) : "") + (r.resolution_note ? " · " + r.resolution_note : "") }),
      err
    ]));
  }
  function outsideItem(r) {
    var reasons = h("textarea", { class: "textarea", rows: "3", maxlength: "2000", "aria-label": "Reasons", placeholder: "For a removal: what it is, and which rule or law it breaks. Otherwise a short note on what you did." });
    var ground = h("select", { class: "select", "aria-label": "Ground" }, [h("option", { value: "terms", text: "Breaks Brainchild's house rules" }), h("option", { value: "illegal", text: "Illegal content" })]);
    var err = h("p", { class: "form-error", role: "alert" });
    function send(decision) {
      err.textContent = "";
      BC.api("POST", "/api/mod/outside/" + r.id + "/resolve", { decision: decision, ground: ground.value, reasons: reasons.value }).then(function (res) {
        if (res.ok) return load();
        err.textContent = res.data.error === "invalid_fields" ? "A removal needs its reasons written out (at least a sentence)." : res.data.error === "no_project_to_remove" ? "This address isn't a project page, so there is nothing to remove from here." : BC.errorText(res.data.error);
      });
    }
    var safe = /^https:\/\/([a-z0-9-]+\.)?(brainchild|brainwave)\.nexus(\/|$)/.test(r.url);
    var canRemove = r.project_id && !r.project_hidden;
    return h("div", { class: "panel queue-item" }, [
      h("h3", { text: (CAT[r.category] || r.category) + " · no account · " + BC.niceDate(r.created_at) }),
      h("p", null, ["Page: ", safe ? h("a", { href: r.url, rel: "noopener noreferrer", target: "_blank", text: r.url }) : r.url]),
      r.project_title ? h("p", { text: "Project: " + r.project_title + (r.project_owner ? " by @" + r.project_owner : "") + (r.project_hidden ? " (already removed)" : "") }) : null,
      h("blockquote", { class: "quote", text: r.details }),
      r.reply_to ? h("p", null, [h("strong", { text: "Reply-to (private, deleted when you close this): " }), r.reply_to]) : null,
      view === "open" ? h("div", { class: "form-grid" }, [h("div", { class: "field wide" }, [reasons]), canRemove ? h("div", { class: "field" }, [ground]) : null]) : null,
      view === "open" ? h("div", { class: "actions" }, [
        canRemove ? btn("Remove the project", "btn-primary", function () { send("remove"); }) : null,
        btn("Dealt with another way", "btn-ghost", function () { send("handled"); }),
        btn("Dismiss the report", "btn-ghost", function () { send("dismiss"); })
      ]) : h("p", { class: "muted", text: "Outcome: " + r.status + (r.resolved_at ? " on " + BC.niceDate(r.resolved_at) : "") + (r.resolution_note ? " · " + r.resolution_note : "") }),
      err
    ]);
  }
  // A Relay pull request the winning maintainer flagged as junk.
  function flagItem(f) {
    var reasons = h("textarea", { class: "textarea", rows: "3", maxlength: "2000", "aria-label": "Reasons", placeholder: "To agree with the flag: what is wrong with the pull request. The contributor will read this." });
    var err = h("p", { class: "form-error", role: "alert" });
    function send(decision) {
      err.textContent = "";
      BC.api("POST", "/api/mod/relay-flags/" + f.id + "/resolve", { decision: decision, reasons: reasons.value }).then(function (res) {
        if (res.ok) return load();
        err.textContent = res.data.error === "invalid_fields" ? "Agreeing with a flag needs its reasons written out (at least a sentence)." : res.data.error === "own_flag" ? "You raised this flag yourself, so another moderator has to decide it. Until then the pull request still counts." : res.data.error === "own_contribution" ? "This is your own pull request, so another moderator has to decide it. Until then it still counts." : res.data.error === "already_resolved" ? "Someone already decided this flag." : BC.errorText(res.data.error);
      });
    }
    return h("div", { class: "panel queue-item" }, [
      h("h3", { text: (FLAGS[f.flag_reason] || f.flag_reason) + " · flagged by @" + (f.flagged_by || "the maintainer") + " · " + BC.niceDate(f.flagged_at) }),
      h("p", null, ["Pull request by @" + f.contributor + " for ", h("a", { href: "relay.html?month=" + encodeURIComponent(f.month), text: f.project_title + " (Relay, " + f.month + ")" }), ": ", prLink(f.pr_url, f.pr_number, f.pr_title)]),
      h("blockquote", { class: "quote", text: f.note }),
      f.flag_note ? h("p", null, [h("strong", { text: "Maintainer's note: " }), f.flag_note]) : null,
      view === "open" ? h("div", { class: "form-grid" }, [h("div", { class: "field wide" }, [reasons])]) : null,
      view === "open" ? h("div", { class: "actions" }, [btn("Agree: it doesn't count", "btn-primary", function () { send("uphold"); }), btn("Clear the flag: it counts", "btn-ghost", function () { send("clear"); })])
        : h("p", { class: "muted", text: "Outcome: " + f.flag_outcome + (f.flag_decided_at ? " on " + BC.niceDate(f.flag_decided_at) : "") + (f.flag_reasons ? " · " + f.flag_reasons : "") }),
      err
    ]);
  }
  function appealItem(a) {
    var note = h("textarea", { class: "textarea", rows: "2", maxlength: "2000", "aria-label": "Note to the person", placeholder: "A short note to the person (optional)" });
    function send(decision) { BC.api("POST", "/api/mod/actions/" + a.id + "/appeal", { decision: decision, note: note.value }).then(load); }
    return h("div", { class: "panel queue-item" }, [
      h("h3", { text: "Review requested by @" + (a.affected || "someone") + " · " + BC.niceDate(a.appeal_at) })
    ].concat(target(a)).concat([
      h("p", null, [h("strong", { text: a.target_type === "relay_pr" ? "Why it doesn't count: " : "Why it was removed: " }), a.reasons]),
      h("p", null, [h("strong", { text: "Their request: " }), a.appeal_text]),
      note,
      h("div", { class: "actions" }, a.target_type === "relay_pr"
        ? [btn("Let it count after all", "btn-primary", function () { send("restore"); }), btn("Keep the decision", "btn-ghost", function () { send("uphold"); })]
        : [btn("Put it back", "btn-primary", function () { send("restore"); }), btn("Keep it removed", "btn-ghost", function () { send("uphold"); })])
    ]));
  }
  // Merging two accounts that are the same person, when both have been used.
  var NAMES = { github: "GitHub", gitlab: "GitLab" };
  var LABELS = { "projects.owner_id": "projects", "lineage.user_id": "lineage entries", "license_records.recorded_by": "license records", "comments.user_id": "comments",
    "comment_likes.user_id": "likes", "reports.reporter_id": "reports sent", "reports.resolved_by": "reports decided", "screenshots.uploaded_by": "screenshots",
    "builds.created_by": "builds", "project_changes.user_id": "page edits", "outside_reports.resolved_by": "outside reports decided", "relay_entries.user_id": "Relay entries",
    "relay_votes.voter_id": "Relay rankings", "proposals.user_id": "blog proposals", "votes.user_id": "blog votes", "posts.author_id": "blog posts", "relay_claims.user_id": "task claims",
    "relay_contributions.user_id": "Relay pull requests", "relay_contributions.flagged_by": "flags raised", "relay_contributions.flag_decided_by": "flags decided",
    "relay_badges.user_id": "badges", "relay_badges.awarded_by": "badges awarded", "moderation_actions.affected_user_id": "moderation decisions about them", "moderation_actions.moderator_id": "moderation decisions made" };
  var CONFLICTS = { same_account: "Those are the same account.", both_entered_the_same_relay_round: "Both entered the same Relay round, which one person can't do.",
    both_ranked_in_the_same_relay_round: "Both ranked projects in the same Relay round, which one person can't do." };
  function mergeSection() {
    var from = h("input", { class: "input", type: "text", "aria-label": "Account to fold in", placeholder: "@handle to fold in" });
    var into = h("input", { class: "input", type: "text", "aria-label": "Account to keep", placeholder: "@handle to keep" });
    var out = h("div", { class: "merge-out" });
    function describe(a, title) {
      var acts = Object.keys(a.activity).map(function (k) { return a.activity[k] + " " + (LABELS[k] || k); });
      return h("div", { class: "panel queue-item" }, [h("h3", { text: title + ": @" + a.handle }),
        h("p", { class: "muted", text: "Joined " + BC.niceDate(a.created_at) + " · sign-ins: " + (a.identities.length ? a.identities.map(function (i) { return NAMES[i.provider] + " @" + i.handle; }).join(", ") : "none") }),
        h("p", { text: acts.length ? acts.join(" · ") : "No activity." })]);
    }
    function preview() {
      out.textContent = "";
      BC.api("GET", "/api/mod/merge?from=" + encodeURIComponent(from.value.trim()) + "&into=" + encodeURIComponent(into.value.trim())).then(function (res) {
        if (!res.ok) { out.appendChild(h("p", { class: "form-error", role: "alert", text: res.status === 404 ? "No account called @" + (res.data.missing === "from" ? from.value : into.value).replace(/^@/, "") + "." : BC.errorText(res.data.error) })); return; }
        var d = res.data;
        out.appendChild(describe(d.from, "Fold in"));
        out.appendChild(describe(d.into, "Keep"));
        if (!d.can_merge) {
          out.appendChild(h("p", { class: "form-error", role: "alert", text: d.conflicts.map(function (c) { return CONFLICTS[c] || (c.indexOf("both_have_") === 0 ? "Both have a " + c.slice(10).split("_and_").map(function (p) { return NAMES[p] || p; }).join(" and ") + " sign-in. Ask the person to unlink one first." : c); }).join(" ") }));
          return;
        }
        var reason = h("textarea", { class: "textarea", rows: "2", maxlength: "500", "aria-label": "Reason", placeholder: "Why, e.g. asked through the contact page on 15 Nov, confirmed from both accounts" });
        var err = h("p", { class: "form-error", role: "alert" });
        var go = btn("Merge @" + d.from.handle + " into @" + d.into.handle, "btn-primary", function () {
          if (!window.confirm("Merge @" + d.from.handle + " into @" + d.into.handle + "? This can't be undone.")) return;
          BC.api("POST", "/api/mod/merge", { from: d.from.handle, into: d.into.handle, reason: reason.value }).then(function (r) {
            if (r.ok) { out.textContent = ""; out.appendChild(h("p", { role: "status", text: "Merged. Everything @" + d.from.handle + " did now belongs to @" + r.data.into + "." })); return; }
            err.textContent = r.data.error === "invalid_fields" ? "Write the reason (at least a sentence)." : r.data.error === "cannot_merge" ? "Something changed; preview again." : BC.errorText(r.data.error);
          });
        });
        out.appendChild(h("p", { class: "muted", text: "Everything the first account did moves to the second, credit included; the first account is then removed. A blog vote in the same month, a like on the same comment or a claim on the same task is kept from the second account only." }));
        out.appendChild(reason); out.appendChild(h("div", { class: "actions" }, [go])); out.appendChild(err);
      });
    }
    return h("section", null, [
      h("h2", { text: "Merge two accounts" }),
      h("p", { class: "muted", text: "For one person with two accounts that have both been used. Only do this when they asked and you're sure both are theirs, for example by asking them to confirm while signed in to each." }),
      h("div", { class: "form-grid" }, [h("div", { class: "field" }, [from]), h("div", { class: "field" }, [into])]),
      h("div", { class: "actions" }, [btn("Preview", "btn-ghost", preview)]),
      out
    ]);
  }

  // Possible vote rigging. Counts and ages only: no addresses, no hashes, and nothing happens automatically.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function monthName(m) { return MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(0, 4); }
  function what(kind, scope, n) {
    return kind === "vote" ? (n === 1 ? "voted" : n + " votes") + " in the blog vote for " + monthName(scope)
      : kind === "relay_entry" ? (n === 1 ? "entered" : n + " entries in") + " the " + monthName(scope) + " Relay round"
      : (n === 1 ? "ranked projects in" : n + " rankings in") + " the " + monthName(scope) + " Relay round";
  }
  function signalsSection(sig) {
    if (!sig || (!sig.shared_networks.length && !sig.accounts.length)) return null;
    var WHY = { new_account: "Brainchild account under 14 days old", new_linked_account: "GitHub/GitLab account under 30 days old", no_public_activity: "no public repositories or projects" };
    var items = sig.shared_networks.map(function (x) {
      return h("li", { text: what(x.kind, x.scope, x.count).replace(/^\d+ /, function (m) { return m; }) + " came from one network." });
    }).concat(sig.accounts.map(function (a) {
      var linked = a.linked.map(function (l) { return (NAMES[l.provider] || l.provider) + (l.age_days !== null ? " " + l.age_days + " days old" : "") + (l.public_activity === false ? ", nothing public" : ""); }).join("; ");
      return h("li", null, [h("a", { href: "user.html?u=" + encodeURIComponent(a.handle), text: "@" + a.handle }), " " + what(a.kind, a.scope, 1) + ": " + a.why.map(function (w) { return WHY[w] || w; }).join(", ") +
        (a.account_age_days !== null ? " (Brainchild account " + a.account_age_days + " days old" + (linked ? "; " + linked : "") + ")" : "")]);
    }));
    return h("section", null, [h("h2", { text: "Signals worth a look" }),
      h("p", { class: "muted", text: "Possible vote rigging. These are hints, not proof: people share networks at home, at school and at work. Nothing happens automatically; addresses are never stored." }),
      h("ul", { class: "relay-how" }, items)]);
  }

  function load() {
    BC.api("GET", "/api/mod/reports" + (view === "closed" ? "?status=closed" : "")).then(function (res) {
      if (!res.ok) return message(res.status === 401 ? "Sign in to see the moderation queue." : res.status === 403 ? "This page is for Brainchild's moderators." : BC.errorText("server_error"));
      var d = res.data;
      root.textContent = "";
      root.appendChild(h("div", { class: "actions" }, [
        btn("Open reports", view === "open" ? "btn-light" : "btn-ghost", function () { view = "open"; load(); }),
        btn("Closed reports", view === "closed" ? "btn-light" : "btn-ghost", function () { view = "closed"; load(); })]));
      var sigs = view === "open" ? signalsSection(d.signals) : null;
      if (sigs) root.appendChild(sigs);
      if (d.appeals.length) { root.appendChild(h("h2", { text: "Requests to review a removal" })); root.appendChild(h("div", { class: "queue" }, d.appeals.map(appealItem))); }
      if (d.rating_changes && d.rating_changes.length) {
        root.appendChild(h("h2", { text: "Rating changes by maintainers" }));
        root.appendChild(h("div", { class: "queue" }, d.rating_changes.map(function (c) {
          var notes = function (t) { try { var a = JSON.parse(t || "[]"); return a.length ? " (" + a.join(", ").toLowerCase() + ")" : ""; } catch (e) { return ""; } };
          return h("div", { class: "panel queue-item" }, [
            h("p", null, [h("a", { href: "project.html?id=" + encodeURIComponent(c.project_id), text: c.project_title }), " · @" + (c.changed_by || "unknown") + " · " + BC.niceDate(c.changed_at)]),
            h("p", { text: "From " + c.rating_old + notes(c.notes_old) + " to " + c.rating_new + notes(c.notes_new) })
          ]);
        })));
      }
      if (d.relay_flags && d.relay_flags.length) {
        root.appendChild(h("h2", { text: view === "open" ? "Relay pull requests flagged as junk" : "Relay flags already decided" }));
        root.appendChild(h("div", { class: "queue" }, d.relay_flags.map(flagItem)));
      }
      if (d.outside && d.outside.length) {
        root.appendChild(h("h2", { text: view === "open" ? "Reports from people who aren't signed in" : "Closed reports from people who weren't signed in" }));
        root.appendChild(h("div", { class: "queue" }, d.outside.map(outsideItem)));
      }
      root.appendChild(h("h2", { text: view === "open" ? "Open reports" : "Closed reports" }));
      root.appendChild(d.reports.length ? h("div", { class: "queue" }, d.reports.map(reportItem)) : h("p", { class: "muted", text: view === "open" ? "Nothing waiting. Every report has been dealt with." : "No closed reports yet." }));
      if (view === "open") root.appendChild(mergeSection());
    });
  }
  if (window.location.protocol === "file:") return message("This page only works on the live site.");
  load();
})();
