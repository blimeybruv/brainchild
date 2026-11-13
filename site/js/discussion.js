/* Project page extras: discussion, reporting, screenshots. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h;
  var id = new URLSearchParams(window.location.search).get("id") || "moss-keeper";
  var root = document.getElementById("discussion");
  if (!root || window.location.protocol === "file:") return;
  var st = { data: null, user: null, sort: "top", draft: "", replyTo: null, replyDraft: "", error: "", busy: false };
  var CATS = [
    ["sexual", "Sexual content", "Not allowed on Brainchild, including in mods."],
    ["rating", "Wrong rating", "It should be rated Teen or Mature, or needs content notes."],
    ["malware", "Malware or suspicious download", "It does something harmful or unexpected."],
    ["license", "License or copyright problem", "Someone else's work, or the license is wrong."],
    ["harass", "Harassment or hate", "Targets a person or group."],
    ["spam", "Spam or junk", "Ads, scams, or no real content."],
    ["other", "Something else", "Tell us in the details."]
  ];

  function when(s) { return BC.niceDate(s); }
  function avatar(c, size) {
    var ok = typeof c.avatar_url === "string" && c.avatar_url.indexOf("https://avatars.githubusercontent.com/") === 0;
    return ok ? h("img", { class: "avatar", src: c.avatar_url + "&s=" + size * 2, alt: "", width: String(size), height: String(size), loading: "lazy", referrerpolicy: "no-referrer" })
      : h("span", { class: "avatar", "aria-hidden": "true" });
  }
  function small(label, onClick, pressed) {
    var b = h("button", { class: "chip", type: "button", text: label, "aria-pressed": pressed === undefined ? null : pressed ? "true" : "false" });
    b.addEventListener("click", onClick);
    return b;
  }
  function load() {
    return BC.api("GET", "/api/projects/" + encodeURIComponent(id) + "/comments").then(function (res) {
      if (!res.ok) { root.hidden = true; return; }
      st.data = res.data;
      render();
    });
  }
  function act(url, body) {
    return BC.api("POST", url, body || {}).then(function (res) {
      if (!res.ok) { st.error = res.data && res.data.error === "slow_down" ? "You're posting quickly. Wait a few minutes and try again." : BC.errorText(res.data && res.data.error); render(); return false; }
      st.error = "";
      return load().then(function () { return true; });
    });
  }
  function signInLink(text) {
    return h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent(window.location.pathname + window.location.search + "#discussion"), text: text });
  }
  function box(value, onInput, label, placeholder, onPost, postLabel) {
    var ta = h("textarea", { class: "textarea", rows: "3", maxlength: "2000", placeholder: placeholder, "aria-label": label });
    ta.value = value;
    var post = h("button", { class: "btn btn-primary", type: "button", text: postLabel, disabled: value.trim() ? null : true });
    ta.addEventListener("input", function () { onInput(ta.value); post.disabled = !ta.value.trim(); });
    post.addEventListener("click", onPost);
    return h("div", { class: "comment-box" }, [ta, h("div", { class: "comment-box-foot" }, [
      h("span", { class: "muted", text: "Be kind. Maintainers can pin comments; anyone can report one." }), post])]);
  }
  function head(c) {
    return h("div", { class: "comment-head" }, [
      h("strong", { text: "@" + c.user }),
      c.role ? h("span", { class: "pill amber", text: c.role }) : null,
      h("span", { class: "muted", text: "· " + when(c.created_at) })
    ].concat((c.badges || []).map(function (b) { return h("span", { class: "pill", title: b.title || null, text: "★ " + b.label }); })));
  }
  function comment(c) {
    var d = st.data, actions = [];
    if (!c.removed) {
      if (d.signed_in) {
        actions.push(small("Reply", function () { st.replyTo = st.replyTo === c.id ? null : c.id; st.replyDraft = ""; render(); }));
        actions.push(small("Helpful · " + c.likes, function () { act("/api/comments/" + c.id + "/like"); }, c.liked));
        actions.push(small("Report", function () { openReport({ comment_id: c.id }, "Report a comment", "Comment by @" + c.user); }));
        if (d.can_pin) actions.push(small(c.pinned ? "Unpin" : "Pin", function () { act("/api/comments/" + c.id + "/pin", { pinned: !c.pinned }); }));
        if (c.mine) actions.push(small("Delete", function () { if (window.confirm("Delete your comment?")) act("/api/comments/" + c.id + "/delete"); }));
      } else {
        actions.push(h("span", { class: "muted", text: "Helpful · " + c.likes }));
      }
    }
    return h("article", { class: "comment" + (c.pinned ? " pinned" : "") }, [
      c.pinned ? h("p", { class: "pin-note", text: "Pinned by the maintainer" }) : null,
      h("div", { class: "comment-row" }, [
        c.removed ? h("span", { class: "avatar", "aria-hidden": "true" }) : avatar(c, 40),
        h("div", { class: "comment-main" }, [
          c.removed ? h("p", { class: "muted", text: "[ comment removed ]" }) : head(c),
          c.removed ? null : h("p", { class: "comment-body", text: c.body }),
          actions.length ? h("div", { class: "comment-actions" }, actions) : null
        ].concat(c.replies.map(function (r) {
          var mine = r.mine && d.signed_in ? small("Delete", function () { if (window.confirm("Delete your reply?")) act("/api/comments/" + r.id + "/delete"); }) : null;
          var rep = d.signed_in ? small("Report", function () { openReport({ comment_id: r.id }, "Report a comment", "Reply by @" + r.user); }) : null;
          return h("div", { class: "comment-row reply" }, [avatar(r, 30), h("div", { class: "comment-main" }, [head(r), h("p", { class: "comment-body", text: r.body }),
            h("div", { class: "comment-actions" }, [rep, mine])])]);
        })).concat(st.replyTo === c.id ? [box(st.replyDraft, function (v) { st.replyDraft = v; }, "Write a reply", "Write a reply…", function () {
          act("/api/projects/" + encodeURIComponent(id) + "/comments", { body: st.replyDraft, parent_id: c.id }).then(function (ok) { if (ok) { st.replyTo = null; st.replyDraft = ""; render(); } });
        }, "Post reply")] : []))
      ])
    ]);
  }
  function render() {
    var d = st.data;
    var pinned = d.comments.filter(function (c) { return c.pinned; });
    var rest = d.comments.filter(function (c) { return !c.pinned; });
    rest.sort(st.sort === "top" ? function (a, b) { return b.likes - a.likes || b.id - a.id; } : function (a, b) { return b.id - a.id; });
    root.textContent = "";
    root.appendChild(h("div", { class: "disc-head" }, [
      h("h2", { id: "disc-h" }, ["Discussion ", h("span", { class: "muted", text: "· " + d.count + (d.count === 1 ? " comment" : " comments") })]),
      h("div", { role: "group", "aria-label": "Sort comments", class: "comment-actions" }, [
        small("Top", function () { st.sort = "top"; render(); }, st.sort === "top"), small("Newest", function () { st.sort = "new"; render(); }, st.sort === "new")])
    ]));
    root.appendChild(d.signed_in
      ? box(st.draft, function (v) { st.draft = v; }, "Write a comment", "Ask the maker a question, report a bug, or share an idea…", function () {
          var text = st.draft;
          act("/api/projects/" + encodeURIComponent(id) + "/comments", { body: text }).then(function (ok) { if (ok) { st.draft = ""; st.sort = "new"; render(); } });
        }, "Post comment")
      : h("p", { class: "callout plain" }, [signInLink("Sign in with GitHub"), " to comment, mark comments helpful, or report one."]));
    if (st.error) root.appendChild(h("p", { class: "form-error", role: "alert", text: st.error }));
    var list = h("div", { class: "comments" }, pinned.concat(rest).map(comment));
    if (!d.comments.length) list.appendChild(h("p", { class: "muted", text: "No comments yet. Start the conversation." }));
    root.appendChild(list);
  }

  // ----- report dialog -----
  function openReport(target, title, context) {
    var dialog = document.getElementById("report-dialog");
    var cat = null, body = h("div", { class: "report-body" });
    function close() { dialog.close(); }
    function form(error) {
      var details = h("textarea", { class: "textarea", id: "report-details", rows: "3", maxlength: "1000", placeholder: "Where is it, and what's the problem?" });
      var send = h("button", { class: "btn btn-primary", type: "button", text: "Send report", disabled: cat ? null : true });
      send.addEventListener("click", function () {
        send.disabled = true;
        var payload = { category: cat, details: details.value };
        if (target.comment_id) payload.comment_id = target.comment_id; else payload.project_id = id;
        BC.api("POST", "/api/reports", payload).then(function (res) {
          if (res.ok) return done();
          var e = res.data && res.data.error;
          form(e === "invalid_fields" ? "Please add some details." : e === "slow_down" ? "You've sent a lot of reports today. Try again tomorrow." : BC.errorText(e));
        });
      });
      var cancel = h("button", { class: "btn btn-ghost", type: "button", text: "Cancel" });
      cancel.addEventListener("click", close);
      var keep = details.value;
      body.textContent = "";
      body.appendChild(BC.choices("What's wrong?", CATS.map(function (c) { return { value: c[0], label: c[1], desc: c[2] }; }), cat, function (v) { cat = v; keep = details.value; form(); document.getElementById("report-details").value = keep; }, "stack"));
      body.appendChild(h("div", { class: "field" }, [h("label", { for: "report-details", text: "Details (optional)" }), details]));
      if (error) body.appendChild(h("p", { class: "form-error", role: "alert", text: error }));
      body.appendChild(h("div", { class: "actions" }, [cancel, send]));
    }
    function done() {
      var ok = h("button", { class: "btn btn-primary", type: "button", text: "Done" });
      ok.addEventListener("click", close);
      body.textContent = "";
      body.appendChild(h("p", null, [h("strong", { text: "Thanks, your report is in. " }), "A moderator reviews every report. You can see what happened to it under your account."]));
      body.appendChild(h("p", { class: "muted", text: "Anything sexual involving a minor is removed immediately and reported to the authorities. If someone is in danger, contact the police." }));
      body.appendChild(h("div", { class: "actions" }, [ok]));
    }
    var x = h("button", { class: "btn btn-plain", type: "button", "aria-label": "Close", text: "×" });
    x.addEventListener("click", close);
    dialog.textContent = "";
    dialog.appendChild(h("div", { class: "rules-head" }, [h("div", null, [h("h2", { id: "report-h", text: title }), h("p", { class: "muted", text: context })]), x]));
    dialog.appendChild(body);
    if (st.user) form();
    else { body.appendChild(h("p", null, [signInLink("Sign in with GitHub"), " to send a report."])); }
    dialog.showModal();
  }
  var reportLinks = document.querySelectorAll("[data-report-project]");
  Array.prototype.forEach.call(reportLinks, function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); openReport({}, "Report this project", document.getElementById("p-title").textContent); });
  });

  // ----- screenshots -----
  document.addEventListener("bc:project", function (e) {
    var p = e.detail, strip = document.getElementById("p-shots"), stage = document.getElementById("p-stage");
    var shots = p.screenshots || [];
    function show(n) {
      var old = stage.querySelector("img.stage-shot");
      if (old) old.remove();
      if (n) stage.insertBefore(h("img", { class: "stage-shot", src: "/api/screenshots/" + n, alt: "Screenshot of " + p.title }), stage.firstChild);
    }
    function draw() {
      strip.textContent = "";
      shots.forEach(function (n, i) {
        var b = h("button", { type: "button", class: "thumb", "aria-label": "Show screenshot " + (i + 1) }, [h("img", { src: "/api/screenshots/" + n, alt: "", loading: "lazy" })]);
        b.addEventListener("click", function () { show(n); });
        var wrap = h("span", { class: "thumb-wrap" }, [b]);
        if (mine) {
          var del = small("Remove", function () {
            BC.api("POST", "/api/screenshots/" + n + "/delete", {}).then(function (res) { if (res.ok) { shots.splice(shots.indexOf(n), 1); show(shots[0]); draw(); } else note(BC.errorText(res.data && res.data.error)); });
          });
          wrap.appendChild(del);
        }
        strip.appendChild(wrap);
      });
      if (mine && shots.length < 6) {
        var file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "visually-hidden", id: "shot-file" });
        file.addEventListener("change", function () {
          var f = file.files[0];
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) return note("That image is over 2 MB. Make it smaller and try again.");
          note("Uploading…");
          fetch("/api/projects/" + encodeURIComponent(p.id) + "/screenshots", { method: "POST", credentials: "same-origin", headers: { "content-type": f.type || "application/octet-stream" }, body: f })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (res) {
              if (!res.ok) return note({ not_an_image: "Only PNG, JPEG or WebP images can be uploaded.", image_too_large: "That image is over 2 MB.", too_many_screenshots: "A project can have 6 screenshots at most.", listing_not_verified: "List this project again through List a project first, so its repository is verified." }[res.j.error] || BC.errorText(res.j.error));
              note("");
              if (shots.indexOf(res.j.id) < 0) shots.push(res.j.id);
              show(shots[0]); draw();
            }, function () { note(BC.errorText("server_error")); });
        });
        strip.appendChild(h("label", { class: "btn btn-ghost", for: "shot-file", text: "Add a screenshot" }));
        strip.appendChild(file);
      }
      if (msg) strip.appendChild(h("p", { class: "muted", role: "status", text: msg }));
    }
    var mine = false, msg = "";
    function note(t) { msg = t; draw(); }
    show(shots[0]);
    draw();
    BC.whoAmI().then(function (u) { mine = !!u && u.handle === p.owner; if (mine) draw(); });
  });

  BC.whoAmI().then(function (u) { st.user = u; load(); });
})();
