/* Your notices: decisions about things you posted, and what happened to your reports. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var CAT = { sexual: "Sexual content", rating: "Wrong rating", malware: "Malware or suspicious download", license: "License or copyright problem", harass: "Harassment or hate", spam: "Spam or junk", other: "Something else" };
  function message(parts) { root.textContent = ""; root.appendChild(h("p", { class: "muted" }, parts)); }
  var FLAGS = { no_change: "no real change", spam: "spam", no_effort: "auto-generated with no effort", ignored: "ignored the instructions" };
  // A Relay pull request that a moderator agreed was junk.
  function relayDecision(d) {
    var safe = /^https:\/\/(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull|gitlab\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}\/-\/merge_requests)\/\d+$/.test(d.pr_url || "");
    return [
      h("h3", { text: "Your pull request for \"" + (d.project_title || d.project_id) + "\" doesn't count towards its Relay round · " + BC.niceDate(d.created_at) }),
      d.pr_number ? h("p", null, [safe ? h("a", { href: d.pr_url, rel: "noopener noreferrer", target: "_blank", text: "Pull request #" + d.pr_number }) : "Pull request #" + d.pr_number]) : null,
      h("p", null, [h("strong", { text: "Why: " }), d.reasons]),
      h("p", { class: "muted", text: "The project's maintainer flagged it (" + (FLAGS[d.category] || d.category) + ") and a moderator agreed after looking at it; no automated tool was involved. " +
        "Nothing was removed: the pull request stays on GitHub. Another pull request in the same round can still count." })
    ];
  }
  function decision(d) {
    var relay = d.target_type === "relay_pr";
    var out = relay ? relayDecision(d) : [
      h("h3", { text: (d.target_type === "project" ? "Your project \"" + (d.project_title || d.project_id) + "\" was removed" : d.target_type === "proposal" ? "Your blog proposal for \"" + (d.project_title || d.project_id) + "\" was removed" : "Your comment on \"" + (d.project_title || d.project_id) + "\" was removed") + " · " + BC.niceDate(d.created_at) }),
      d.comment_body ? h("blockquote", { class: "quote", text: d.comment_body }) : d.proposal_goal ? h("blockquote", { class: "quote", text: d.proposal_goal }) : null,
      h("p", null, [h("strong", { text: "Why: " }), d.reasons]),
      h("p", { class: "muted", text: "Ground: " + (d.ground === "illegal" ? "illegal content" : "it breaks Brainchild's house rules") + " (" + (CAT[d.category] || d.category) + "). " +
        "A moderator made this decision after a report; no automated tool was involved. " + (d.target_type === "project" ? "The project's page is hidden; its lineage and license record are kept." : d.target_type === "proposal" ? "The proposal has left the vote and its votes no longer count. The project itself is still listed." : "The comment is no longer shown.") })
    ];
    if (d.appeal_outcome) {
      out.push(h("p", null, [h("strong", { text: d.appeal_outcome === "restored" ? (relay ? "Reviewed: it counts after all. " : "Reviewed: it has been put back. ") : (relay ? "Reviewed: the decision stands. " : "Reviewed: the removal stands. ") }), d.appeal_note || ""]));
    } else if (d.appeal_at) {
      out.push(h("p", { class: "muted", text: "You asked for a review on " + BC.niceDate(d.appeal_at) + ". A moderator will look at it again." }));
    } else {
      var text = h("textarea", { class: "textarea", rows: "3", maxlength: "2000", "aria-label": "Why this should be looked at again", placeholder: "If you think this was a mistake, say why." });
      var err = h("p", { class: "form-error", role: "alert" });
      var ask = h("button", { class: "btn btn-ghost", type: "button", text: "Ask for a review" });
      ask.addEventListener("click", function () {
        BC.api("POST", "/api/my/notices/" + d.id + "/appeal", { text: text.value }).then(function (res) {
          if (res.ok) return load();
          err.textContent = res.data.error === "invalid_fields" ? "Write a sentence or two explaining why." : BC.errorText(res.data.error);
        });
      });
      out.push(text, h("div", { class: "actions" }, [ask]), err,
        h("p", { class: "muted", style: "font-size:14px", text: "You can ask once for each decision. You also keep any right you have to take the matter to a dispute body or a court." }));
    }
    return h("div", { class: "panel queue-item" }, out);
  }
  // Sign-ins: the GitHub and GitLab accounts linked to this Brainchild account.
  var NAMES = { github: "GitHub", gitlab: "GitLab" };
  function signIns(box) {
    Promise.all([BC.api("GET", "/api/my/identities"), BC.getJSON("/api/me").catch(function () { return {}; })]).then(function (r) {
      var res = r[0], me = r[1] || {}, avail = me.providers || {};
      box.textContent = "";
      if (!res.ok) return;
      var d = res.data, err = h("p", { class: "form-error", role: "alert" });
      box.appendChild(h("h2", { text: "Sign-ins" }));
      box.appendChild(h("p", { class: "muted", text: "Your projects, comments, credit and badges belong to your Brainchild account. You can sign in with any account linked here." }));
      var rows = ["github", "gitlab"].map(function (p) {
        var it = d.identities.filter(function (x) { return x.provider === p; })[0];
        var back = encodeURIComponent("/account.html");
        var linkHref = p === "github" ? "/api/auth/login?provider=github&link=1&return_to=" + back : "/api/auth/gitlab/login?link=1&return_to=" + back;
        var controls = [];
        if (it) {
          if (!it.connected && avail[p]) controls.push(h("a", { class: "btn btn-ghost", href: linkHref, text: "Connect for this session" }));
          if (d.identities.length > 1) {
            var un = h("button", { class: "btn btn-ghost", type: "button", text: "Unlink" });
            un.addEventListener("click", function () {
              if (!window.confirm("Unlink your " + NAMES[p] + " account? You can link it again later.")) return;
              BC.api("POST", "/api/my/identities/" + p + "/unlink", {}).then(function (x) { if (x.ok) signIns(box); else err.textContent = BC.errorText(x.data && x.data.error); });
            });
            controls.push(un);
          }
        } else if (avail[p]) {
          controls.push(h("a", { class: "btn btn-light", href: linkHref, text: "Link a " + NAMES[p] + " account" }));
        }
        return h("div", { class: "relay-entry" }, [h("div", { class: "c-grow" }, [
          h("p", { class: "relay-title" }, [NAMES[p], it ? h("span", { class: "pill", text: "@" + it.handle }) : null]),
          h("p", { class: "muted", text: it ? "Linked " + BC.niceDate(it.linked_at) + (it.connected ? " · connected in this session" : "") : avail[p] ? "Not linked." : "Not linked. Linking isn't available at this address." })
        ]), controls.length ? h("div", { class: "actions" }, controls) : null]);
      });
      box.appendChild(h("div", { class: "relay-list" }, rows));
      if (d.identities.length === 1) box.appendChild(h("p", { class: "muted", style: "font-size:14px", text: "Your only sign-in can't be unlinked." }));
      var show = h("input", { type: "checkbox", id: "show-ids" });
      show.checked = d.show_identities;
      show.addEventListener("change", function () {
        BC.api("POST", "/api/my/profile", { show_identities: show.checked }).then(function (x) { if (!x.ok) { show.checked = !show.checked; err.textContent = BC.errorText(x.data && x.data.error); } });
      });
      box.appendChild(h("label", { class: "check", for: "show-ids" }, [show, h("span", { text: "Show my linked GitHub and GitLab usernames on my public profile" })]));
      box.appendChild(err);
    });
  }

  function load() {
    BC.api("GET", "/api/my/notices").then(function (res) {
      if (res.status === 401) return message([h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/account.html"), text: "Sign in with GitHub" }), " to see your notices."]);
      if (!res.ok) return message([BC.errorText("server_error")]);
      var d = res.data, S = { open: "Waiting for a moderator", actioned: "Looked at: it was removed", dismissed: "Looked at: no action was taken" };
      root.textContent = "";
      var ids = h("section", { class: "account-signins" });
      root.appendChild(ids);
      signIns(ids);
      root.appendChild(h("h2", { text: "Decisions about things you posted" }));
      root.appendChild(d.decisions.length ? h("div", { class: "queue" }, d.decisions.map(decision)) : h("p", { class: "muted", text: "No decisions have been made about anything of yours." }));
      if (d.pitches && d.pitches.length) {
        var PS = { open: "Waiting for a moderator", drafted: "A moderator is editing it", published: "Published", declined: "Not taken up" };
        root.appendChild(h("h2", { text: "Your blog pitches" }));
        root.appendChild(h("div", { class: "queue" }, d.pitches.map(function (p) {
          return h("div", { class: "panel queue-item" }, [
            h("h3", null, [p.post_slug ? h("a", { href: "post.html?slug=" + encodeURIComponent(p.post_slug), text: p.title }) : p.title]),
            h("p", { class: "muted", text: "Sent " + BC.niceDate(p.created_at) + " · " + (PS[p.status] || p.status) + (p.resolved_at ? " · " + BC.niceDate(p.resolved_at) : "") }),
            p.note ? h("p", null, [h("strong", { text: "Note from the moderator: " }), p.note]) : null
          ]);
        })));
      }
      root.appendChild(h("h2", { text: "Your reports" }));
      root.appendChild(d.reports.length ? h("div", { class: "queue" }, d.reports.map(function (r) {
        return h("div", { class: "panel queue-item" }, [
          h("h3", { text: (CAT[r.category] || r.category) + " · " + (r.target_type === "comment" ? "a comment on " : r.target_type === "proposal" ? "a blog proposal for " : "") + "\"" + (r.project_title || r.project_id) + "\"" }),
          h("p", { class: "muted", text: "Sent " + BC.niceDate(r.created_at) + " · " + (S[r.status] || r.status) + (r.resolved_at ? " on " + BC.niceDate(r.resolved_at) : "") })
        ]);
      })) : h("p", { class: "muted", text: "You haven't reported anything." }));
    });
  }
  if (window.location.protocol === "file:") return message(["This page only works on the live site."]);
  load();
})();
