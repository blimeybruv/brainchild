/* Your notices: decisions about things you posted, and what happened to your reports. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var CAT = { sexual: "Sexual content", rating: "Wrong rating", malware: "Malware or suspicious download", license: "License or copyright problem", harass: "Harassment or hate", spam: "Spam or junk", other: "Something else" };
  function message(parts) { root.textContent = ""; root.appendChild(h("p", { class: "muted" }, parts)); }
  function decision(d) {
    var out = [
      h("h3", { text: (d.target_type === "project" ? "Your project \"" + (d.project_title || d.project_id) + "\" was removed" : "Your comment on \"" + (d.project_title || d.project_id) + "\" was removed") + " · " + BC.niceDate(d.created_at) }),
      d.comment_body ? h("blockquote", { class: "quote", text: d.comment_body }) : null,
      h("p", null, [h("strong", { text: "Why: " }), d.reasons]),
      h("p", { class: "muted", text: "Ground: " + (d.ground === "illegal" ? "illegal content" : "it breaks Brainchild's house rules") + " (" + (CAT[d.category] || d.category) + "). " +
        "A moderator made this decision after a report; no automated tool was involved. " + (d.target_type === "project" ? "The project's page is hidden; its lineage and license record are kept." : "The comment is no longer shown.") })
    ];
    if (d.appeal_outcome) {
      out.push(h("p", null, [h("strong", { text: d.appeal_outcome === "restored" ? "Reviewed: it has been put back. " : "Reviewed: the removal stands. " }), d.appeal_note || ""]));
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
        h("p", { class: "muted", style: "font-size:14px", text: "You can ask once for each removal. You also keep any right you have to take the matter to a dispute body or a court." }));
    }
    return h("div", { class: "panel queue-item" }, out);
  }
  function load() {
    BC.api("GET", "/api/my/notices").then(function (res) {
      if (res.status === 401) return message([h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/account.html"), text: "Sign in with GitHub" }), " to see your notices."]);
      if (!res.ok) return message([BC.errorText("server_error")]);
      var d = res.data, S = { open: "Waiting for a moderator", actioned: "Looked at: it was removed", dismissed: "Looked at: no action was taken" };
      root.textContent = "";
      root.appendChild(h("h2", { text: "Decisions about things you posted" }));
      root.appendChild(d.decisions.length ? h("div", { class: "queue" }, d.decisions.map(decision)) : h("p", { class: "muted", text: "Nothing of yours has been removed." }));
      root.appendChild(h("h2", { text: "Your reports" }));
      root.appendChild(d.reports.length ? h("div", { class: "queue" }, d.reports.map(function (r) {
        return h("div", { class: "panel queue-item" }, [
          h("h3", { text: (CAT[r.category] || r.category) + " · " + (r.target_type === "comment" ? "a comment on " : "") + "\"" + (r.project_title || r.project_id) + "\"" }),
          h("p", { class: "muted", text: "Sent " + BC.niceDate(r.created_at) + " · " + (S[r.status] || r.status) + (r.resolved_at ? " on " + BC.niceDate(r.resolved_at) : "") })
        ]);
      })) : h("p", { class: "muted", text: "You haven't reported anything." }));
    });
  }
  if (window.location.protocol === "file:") return message(["This page only works on the live site."]);
  load();
})();
