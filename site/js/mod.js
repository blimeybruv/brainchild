/* Moderation queue. Only moderators get data from the API. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var CAT = { sexual: "Sexual content", rating: "Wrong rating", malware: "Malware or suspicious download", license: "License or copyright problem", harass: "Harassment or hate", spam: "Spam or junk", other: "Something else" };
  var view = "open";
  function message(text) { root.textContent = ""; root.appendChild(h("p", { class: "muted", text: text })); }
  function btn(label, cls, onClick) { var b = h("button", { class: "btn " + cls, type: "button", text: label }); b.addEventListener("click", onClick); return b; }
  function target(r) {
    var link = h("a", { href: "project.html?id=" + encodeURIComponent(r.project_id), text: r.project_title || r.project_id });
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
  function appealItem(a) {
    var note = h("textarea", { class: "textarea", rows: "2", maxlength: "2000", "aria-label": "Note to the person", placeholder: "A short note to the person (optional)" });
    function send(decision) { BC.api("POST", "/api/mod/actions/" + a.id + "/appeal", { decision: decision, note: note.value }).then(load); }
    return h("div", { class: "panel queue-item" }, [
      h("h3", { text: "Review requested by @" + (a.affected || "someone") + " · " + BC.niceDate(a.appeal_at) })
    ].concat(target(a)).concat([
      h("p", null, [h("strong", { text: "Why it was removed: " }), a.reasons]),
      h("p", null, [h("strong", { text: "Their request: " }), a.appeal_text]),
      note,
      h("div", { class: "actions" }, [btn("Put it back", "btn-primary", function () { send("restore"); }), btn("Keep it removed", "btn-ghost", function () { send("uphold"); })])
    ]));
  }
  function load() {
    BC.api("GET", "/api/mod/reports" + (view === "closed" ? "?status=closed" : "")).then(function (res) {
      if (!res.ok) return message(res.status === 401 ? "Sign in to see the moderation queue." : res.status === 403 ? "This page is for Brainchild's moderators." : BC.errorText("server_error"));
      var d = res.data;
      root.textContent = "";
      root.appendChild(h("div", { class: "actions" }, [
        btn("Open reports", view === "open" ? "btn-light" : "btn-ghost", function () { view = "open"; load(); }),
        btn("Closed reports", view === "closed" ? "btn-light" : "btn-ghost", function () { view = "closed"; load(); })]));
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
      if (d.outside && d.outside.length) {
        root.appendChild(h("h2", { text: view === "open" ? "Reports from people who aren't signed in" : "Closed reports from people who weren't signed in" }));
        root.appendChild(h("div", { class: "queue" }, d.outside.map(outsideItem)));
      }
      root.appendChild(h("h2", { text: view === "open" ? "Open reports" : "Closed reports" }));
      root.appendChild(d.reports.length ? h("div", { class: "queue" }, d.reports.map(reportItem)) : h("p", { class: "muted", text: view === "open" ? "Nothing waiting. Every report has been dealt with." : "No closed reports yet." }));
    });
  }
  if (window.location.protocol === "file:") return message("This page only works on the live site.");
  load();
})();
