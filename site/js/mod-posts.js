/* Moderators' blog editor. All text goes in with textContent; previews use BC.renderPost. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var d = null, editing = null, msg = "", err = "";
  var SOURCES = { pitch: "a member's pitch", report: "a report", outside_report: "a report from someone without an account" };
  function btn(label, cls, onClick) { var b = h("button", { class: "btn " + cls, type: "button", text: label }); b.addEventListener("click", onClick); return b; }
  function load(thenEdit) {
    return BC.api("GET", "/api/mod/posts").then(function (res) {
      if (!res.ok) { root.textContent = ""; root.appendChild(h("p", { class: "muted", text: res.status === 401 ? "Sign in to see this page." : res.status === 403 ? "This page is for Brainchild's moderators." : BC.errorText("server_error") })); return; }
      d = res.data;
      if (thenEdit) editing = d.posts.filter(function (p) { return p.id === thenEdit; })[0] || null;
      render();
    });
  }
  function act(url, body, after) {
    err = ""; msg = "";
    return BC.api("POST", url, body || {}).then(function (res) {
      if (!res.ok) {
        var e = res.data || {};
        err = e.error === "author_consent_needed" ? "Only name someone as the author if they submitted this or agreed to it. Tick the box to confirm they agreed."
          : e.error === "author_not_found" ? "There's no member with that handle." : e.error === "invalid_fields" ? "Please fill in: " + e.fields.join(", ") + " (the excerpt needs at least 10 characters)." : BC.errorText(e.error);
        render(); return null;
      }
      return after ? after(res.data) : load();
    });
  }

  function editor() {
    var p = editing || {};
    var topic = h("select", { class: "select", id: "e-topic" }, d.topics.map(function (t) { return h("option", { value: t, text: t }); }));
    topic.value = p.topic || d.topics[0];
    var title = h("input", { class: "input", id: "e-title", maxlength: "140" }); title.value = p.title || "";
    var excerpt = h("textarea", { class: "textarea", id: "e-excerpt", rows: "2", maxlength: "300" }); excerpt.value = p.excerpt || "";
    var body = h("textarea", { class: "textarea", id: "e-body", rows: "16", maxlength: "20000" }); body.value = p.body || "";
    var author = h("input", { class: "input", id: "e-author", maxlength: "100", placeholder: "Leave empty for a site post (Brainchild)" }); author.value = p.author || "";
    var consent = h("input", { type: "checkbox", id: "e-consent" });
    var preview = h("div", { class: "panel post-preview" });
    function showPreview() { preview.textContent = ""; preview.appendChild(h("p", { class: "eyebrow", text: "Preview" })); preview.appendChild(BC.renderPost(body.value)); }
    body.addEventListener("input", showPreview); showPreview();
    var save = btn(p.id ? "Save changes" : "Save as draft", "btn-primary", function () {
      act("/api/mod/posts", { id: p.id || null, topic: topic.value, title: title.value, excerpt: excerpt.value, body: body.value, author: author.value, consent: consent.checked },
        function (r) { msg = "Saved."; return load(r.id); });
    });
    var actions = [save, btn("Close", "btn-ghost", function () { editing = null; err = ""; render(); })];
    if (p.id && !p.published_at) actions.push(btn("Publish", "btn-light", function () { act("/api/mod/posts/" + p.id + "/publish", {}, function () { msg = "Published."; return load(p.id); }); }));
    if (p.id && p.published_at) actions.push(btn("Unpublish", "btn-ghost", function () { act("/api/mod/posts/" + p.id + "/unpublish", {}, function () { msg = "Back to draft."; return load(p.id); }); }));
    if (p.id) actions.push(btn("Delete", "btn-ghost", function () { if (window.confirm("Delete \"" + (p.title || "this post") + "\"? This can't be undone.")) act("/api/mod/posts/" + p.id + "/delete", {}, function () { editing = null; msg = "Deleted."; return load(); }); }));
    return h("section", { class: "panel wizard" }, [
      h("h2", { text: p.id ? (p.published_at ? "Editing a published post" : "Editing a draft") : "New post" }),
      p.source_kind ? h("p", { class: "muted", text: "Made from " + SOURCES[p.source_kind] + " (#" + p.source_id + "). Edit it before publishing." }) : null,
      p.published_at ? h("p", { class: "muted" }, ["Live at ", h("a", { href: "post.html?slug=" + encodeURIComponent(p.slug), text: "post.html?slug=" + p.slug }), " since " + BC.niceDate(p.published_at) + "."]) : null,
      h("div", { class: "form-grid" }, [
        h("div", { class: "field" }, [h("label", { for: "e-topic", text: "Topic" }), topic]),
        h("div", { class: "field" }, [h("label", { for: "e-author", text: "Author (a member's handle)" }), author]),
        h("div", { class: "field wide" }, [h("label", { for: "e-title", text: "Title" }), title]),
        h("div", { class: "field wide" }, [h("label", { for: "e-excerpt", text: "Excerpt (shown on the blog page)" }), excerpt]),
        h("div", { class: "field wide" }, [h("label", { for: "e-body", text: "Body" }), body,
          h("span", { class: "hint", text: "Blank line between paragraphs. \"# \" or \"## \" for a heading, \"- \" for a list item, `code`, and [text](https://...) for a link." })])
      ]),
      h("p", { class: "callout plain", text: "Only name someone as the author if they submitted this text or agreed to be named. The person who really writes and edits each post is logged privately below." }),
      h("label", { class: "check", for: "e-consent" }, [consent, h("span", { text: "The named author submitted this or agreed to be named" })]),
      err ? h("p", { class: "form-error", role: "alert", text: err }) : null,
      msg ? h("p", { role: "status", text: msg }) : null,
      h("div", { class: "actions" }, actions),
      preview
    ]);
  }

  function render() {
    root.textContent = "";
    root.appendChild(editing !== null ? editor() : h("div", { class: "actions" }, [btn("Write a new post", "btn-primary", function () { editing = {}; msg = ""; err = ""; render(); })]));
    if (editing === null && msg) root.appendChild(h("p", { role: "status", text: msg }));
    if (editing === null && err) root.appendChild(h("p", { class: "form-error", role: "alert", text: err }));
    root.appendChild(h("h2", { text: "Pitches from members" }));
    root.appendChild(d.pitches.length ? h("div", { class: "queue" }, d.pitches.map(function (p) {
      var note = h("textarea", { class: "textarea", rows: "2", maxlength: "1000", "aria-label": "Note to the member", placeholder: "If declining: a short note to them (optional)" });
      return h("div", { class: "panel queue-item" }, [
        h("h3", { text: p.title + " · " + p.topic }),
        h("p", { class: "muted", text: "Pitched by @" + p.pitched_by + " · " + BC.niceDate(p.created_at) }),
        h("blockquote", { class: "quote", text: p.body.length > 600 ? p.body.slice(0, 600) + "…" : p.body }),
        note,
        h("div", { class: "actions" }, [
          btn("Make it a draft", "btn-primary", function () { act("/api/mod/pitches/" + p.id + "/draft", {}, function (r) { msg = "Draft made, with @" + p.pitched_by + " as author."; return load(r.post_id); }); }),
          btn("Decline", "btn-ghost", function () { act("/api/mod/pitches/" + p.id + "/decline", { note: note.value }); })])
      ]);
    })) : h("p", { class: "muted", text: "No pitches waiting." }));
    root.appendChild(h("h2", { text: "Posts" }));
    root.appendChild(d.posts.length ? h("div", { class: "queue" }, d.posts.map(function (p) {
      return h("div", { class: "panel queue-item" }, [
        h("h3", null, [p.title, h("span", { class: "pill" + (p.published_at ? "" : " amber"), text: p.published_at ? "Published" : "Draft" })]),
        h("p", { class: "muted", text: p.topic + " · by " + (p.author ? "@" + p.author : "Brainchild") + " · updated " + BC.niceDate(p.updated_at || p.created_at || p.published_at) }),
        h("div", { class: "actions" }, [btn("Edit", "btn-ghost", function () { editing = p; msg = ""; err = ""; render(); window.scrollTo(0, 0); }),
          p.published_at ? h("a", { class: "btn btn-ghost", href: "post.html?slug=" + encodeURIComponent(p.slug), text: "View" }) : null])
      ]);
    })) : h("p", { class: "muted", text: "No posts yet." }));
    root.appendChild(h("h2", { text: "Who changed what" }));
    root.appendChild(d.edits.length ? h("ul", { class: "relay-how" }, d.edits.map(function (e) {
      return h("li", { text: BC.niceDate(e.at) + " " + e.at.slice(11, 16) + " · @" + (e.by || "unknown") + " · " + e.action + " · \"" + e.title + "\"" });
    })) : h("p", { class: "muted", text: "Nothing yet." }));
  }

  if (window.location.protocol === "file:") { root.textContent = "This page only works on the live site."; return; }
  var want = Number(new URLSearchParams(window.location.search).get("edit")) || null;
  load(want);
})();
