/* Adopt a project: the adopter's side of a handoff. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h;
  var body = document.getElementById("w-body");
  var STEPS = ["Sign in", "Transfer or fork", "Link your repo", "Ownership", "Done"];
  var id = new URLSearchParams(window.location.search).get("id") || "";
  var st = { step: 1, user: null, p: null, lineage: [], method: "fork", repo: "", title: "", check: null, done: null, error: "", busy: false };

  function go(n) { st.step = n; st.error = ""; render(); window.scrollTo(0, 0); }
  function btn(label, onClick, cls, disabled) {
    var b = h("button", { class: "btn " + (cls || "btn-primary"), type: "button", text: label, disabled: disabled ? true : null });
    b.addEventListener("click", onClick);
    return b;
  }
  function back() { return st.step > 1 && !st.done ? btn("Back", function () { go(st.step - 1); }, "btn-ghost") : null; }
  function errorLine() { return st.error ? h("p", { class: "form-error", role: "alert", text: st.error }) : null; }
  function oldRepo() { return (st.p.repo_url || "").replace(/^https:\/\//, ""); }
  function released() {
    var r = st.p.license_record, p = st.p;
    return (r ? "Released under " + (r.spdx_id || "a custom license") + " at commit " + String(r.commit_sha).slice(0, 7) : "Listed under " + p.license) +
      (p.owner ? " by " + (p.owner_verified ? "verified owner " : "") + "@" + p.owner : "") + ".";
  }

  function stepSignIn() {
    var p = st.p, out = [h("h2", { text: "Adopt " + p.title })];
    if (p.status !== "adopt") {
      out.push(h("div", { class: "callout bad" }, [h("span", { class: "mark", "aria-hidden": "true", text: "!" }), h("div", null, [
        h("p", null, [h("strong", { text: "This project isn't up for adoption." })]),
        h("p", { text: "Its maker is still looking after it. You can still fork it on GitHub under its license." })])]));
      out.push(h("div", { class: "actions" }, [h("a", { class: "btn btn-ghost", href: "project.html?id=" + encodeURIComponent(p.id), text: "Back to the project" })]));
      return out;
    }
    out.push(h("p", { text: released() + " Sign in with GitHub so we can link your copy." }));
    if (st.user && st.user.handle === p.owner) {
      out.push(h("p", { class: "form-error", text: "You're this project's current maintainer, so there's nothing to adopt." }));
    } else if (st.user) {
      out.push(h("p", { text: "Signed in as @" + st.user.handle + "." }));
      out.push(h("div", { class: "actions" }, [btn("Continue", function () { go(2); })]));
    } else {
      out.push(h("div", { class: "actions" }, [h("a", { class: "btn btn-light", href: "/api/auth/login?return_to=" + encodeURIComponent("/adopt.html?id=" + p.id), text: "Continue with GitHub" })]));
    }
    return out;
  }

  function stepMethod() {
    var offered = !!st.p.open_to_transfer;
    if (!offered) st.method = "fork";
    return [
      h("h2", { text: "How will you take it on?" }),
      BC.choices("Method", [
        { value: "transfer", label: "Ask for a transfer", disabled: !offered,
          desc: offered ? "The maker is open to it. They move the repo to you on GitHub, keeping stars, issues and links." : "Not offered: the maker didn't opt in to transfers." },
        { value: "fork", label: "Fork it", desc: "Make your own copy on GitHub. Full history, plus a visible \"forked from\" link to the original." }
      ], st.method, function (v) { st.method = v; render(); }),
      h("div", { class: "actions" }, [btn("Continue", function () { go(3); }), back()])
    ];
  }

  function stepLink() {
    var p = st.p, transfer = st.method === "transfer";
    var repo = h("input", { class: "input", type: "text", id: "a-repo", maxlength: "220", placeholder: "your-name/" + (oldRepo().split("/")[2] || "project") });
    repo.value = st.repo;
    repo.addEventListener("input", function () { st.repo = repo.value; });
    var title = h("input", { class: "input", type: "text", id: "a-title", maxlength: "80" });
    title.value = st.title;
    title.addEventListener("input", function () { st.title = title.value; });
    var nameHint = p.name_rights === "rename" ? "The maker asked adopters to pick a new name and credit the original."
      : p.name_rights === "continuation" ? "The maker asked adopters to keep \"" + p.title + "\" in the name, with a subtitle of your own if you like."
      : "You can keep the name or change it.";
    return [
      h("h2", { text: transfer ? "Accept the transfer" : "Fork, then link your copy" }),
      h("p", { text: transfer
        ? "Ask @" + (p.owner || "the maker") + " to transfer " + oldRepo() + " to you on GitHub (repository Settings, then Transfer ownership). Once you've accepted it, enter its new address below."
        : "Fork " + oldRepo() + " on GitHub, then enter your fork's address below." }),
      h("div", { class: "form-grid" }, [
        h("div", { class: "field" }, [h("label", { for: "a-repo", text: "Your repository" }), repo, h("span", { class: "hint", text: "In the form owner/name." })]),
        h("div", { class: "field" }, [h("label", { for: "a-title", text: "Project name" }), title, h("span", { class: "hint", text: nameHint })])
      ]),
      errorLine(),
      h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "Check ownership", function () { send(true); }, null, st.busy), back()])
    ];
  }

  function send(dryRun) {
    st.busy = true; st.error = ""; render();
    BC.api("POST", "/api/projects/" + encodeURIComponent(st.p.id) + "/adopt", { repo: st.repo, method: st.method, title: st.title, dry_run: dryRun }).then(function (res) {
      st.busy = false;
      if (!res.ok) {
        var e = res.data || {};
        st.error = e.error === "invalid_fields" ? "Enter your repository as owner/name." : BC.errorText(e.error);
        return render();
      }
      if (dryRun) { st.check = res.data; go(4); } else { st.done = res.data; refresh(); }
    });
  }

  function stepOwnership() {
    var s = st.check.summary;
    var licLine = s.relicensed
      ? "Your copy is under " + (s.license || "a custom license") + "; the original was released under " + (s.previous_license || "a custom license") + ". That's allowed for a permissive license, and only your version changes: the original release stays as it was."
      : "Your copy keeps the license: " + (s.license || "a custom license") + ".";
    return [
      h("h2", { text: "Ownership check" }),
      h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "✓" }), h("div", null, [
        h("p", null, [h("strong", { text: "Verified: @" + st.user.handle + " has admin rights on github.com/" + s.repo })]),
        h("p", { text: s.method === "transfer" ? "Transfer confirmed: this is the project's own repository, now under your account." : "Fork confirmed: GitHub shows it as forked from the original." }),
        h("p", { text: licLine })])]),
      h("p", { class: "muted", text: "Finishing makes you the maintainer of \"" + s.title + "\" on Brainchild. The original maker stays credited in the lineage." }),
      errorLine(),
      h("div", { class: "actions" }, [btn(st.busy ? "Finishing…" : "Finish adopting", function () { send(false); }, null, st.busy), back()])
    ];
  }

  // After adopting, show the lineage as it now stands.
  function refresh() {
    BC.api("GET", "/api/projects/" + encodeURIComponent(st.p.id) + "?t=" + Date.now()).then(function (res) {
      if (res.ok) st.lineage = res.data.lineage || [];
      render();
      window.scrollTo(0, 0);
    });
  }

  function stepDone() {
    var d = st.done, s = d.summary, pid = encodeURIComponent(d.id);
    var rows = st.lineage.length ? st.lineage : [{ handle: st.user.handle, how: s.method === "transfer" ? "transferred" : "forked", repo_full_name: s.repo, ended_at: null }];
    return [
      h("h2", { text: "You're the new maintainer" }),
      h("p", { text: "The project page now points to your repository. The original stays credited, and the license record travels with it." }),
      h("ol", { class: "lineage" }, rows.map(function (l, i) {
        var what = l.how === "forked" ? "forked from the original" : l.how === "transferred" ? "transferred from the original" : "created it";
        return h("li", null, [
          h("div", { class: "rail" }, [h("span", { class: "node", "aria-hidden": "true" }), i < rows.length - 1 ? h("span", { class: "line", "aria-hidden": "true" }) : null]),
          h("div", null, [h("p", { class: "who", text: "@" + l.handle }),
            h("p", { class: "when", text: (l.repo_full_name ? "github.com/" + l.repo_full_name + " · " : "") + what + (l.ended_at ? " · handed off " + BC.niceDate(l.ended_at) : " · current maintainer") })])
        ]);
      })),
      BC.rulesBlock("Paste this into your CLAUDE.md or AGENTS.md", d.rules,
        "AI coding tools read this file every session, so they'll follow the license, credit and name rules even when you forget."),
      h("div", { class: "actions" }, [
        h("a", { class: "btn btn-primary", href: "project.html?id=" + pid, text: "Go to the project page" }),
        h("a", { class: "btn btn-ghost", href: "license.html?id=" + pid, text: "See the license record" })
      ])
    ];
  }

  function render() {
    BC.renderSteps(document.getElementById("w-rail"), STEPS, st.done ? 5 : st.step);
    var parts = st.done ? stepDone() : [stepSignIn, stepMethod, stepLink, stepOwnership][st.step - 1]();
    body.textContent = "";
    parts.forEach(function (x) { if (x) body.appendChild(x); });
  }

  function message(text) { body.textContent = ""; body.appendChild(h("p", { class: "muted", text: text })); }
  if (!/^[a-z0-9-]{1,80}$/.test(id) || window.location.protocol === "file:") return message("No project chosen. Pick one from the Browse page.");
  Promise.all([BC.whoAmI(), BC.api("GET", "/api/projects/" + encodeURIComponent(id))]).then(function (r) {
    st.user = r[0];
    if (!r[1].ok) return message(r[1].status === 404 ? "That project doesn't exist." : BC.errorText("server_error"));
    st.p = r[1].data.project;
    st.lineage = r[1].data.lineage || [];
    st.title = st.p.title;
    document.title = "Adopt " + st.p.title + " · Brainchild";
    render();
  });
})();
