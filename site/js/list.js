/* List a project: the maker's side of a handoff. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, D = window.BC_DATA;
  var body = document.getElementById("w-body");
  var STEPS = ["Start", "Choose repo", "Ownership", "License", "Details", "Publish"];
  var NOTES = ["Violence", "Blood", "Horror", "Strong language", "Drug references", "Gambling-style mechanics", "Historical symbols"];
  var LICENSE_NOTES = {
    "MIT": ["amber", "Accepted. MIT doesn't spell out that it can't be withdrawn; Apache-2.0 or GPLv3 say so explicitly, if you're happy to switch."],
    "Apache-2.0": ["good", "Recommended: the license states its permissions are perpetual and irrevocable. It grants no rights to the project's name, so the name question below matters."],
    "GPL-3.0": ["good", "Recommended: irrevocable, and future versions must stay open too."]
  };
  var params = new URLSearchParams(window.location.search);
  var st = {
    step: 1, user: null, intent: params.get("intent") === "leave" ? "leave" : "stay",
    repos: null, repo: "", manual: "", info: null, error: "", busy: false,
    assets: "CC BY 4.0", nameRights: "continuation", agreed: false,
    f: { title: "", kind: "Game", genre: D.genres[0], base_game: "", tech: "", browser: false, note: "", works: "", broken: "", vision: "", agent_context: "" },
    prov: [{ part: "Code", how: "" }, { part: "Art", how: "" }, { part: "Audio", how: "" }],
    auto: { title: "", agent: "" }, status: "help", transfer: false, rating: "everyone", notes: {}, preview: null, done: null
  };

  function go(n) { st.step = n; st.error = ""; render(); window.scrollTo(0, 0); }
  function btn(label, onClick, cls, disabled) {
    var b = h("button", { class: "btn " + (cls || "btn-primary"), type: "button", text: label, disabled: disabled ? true : null });
    b.addEventListener("click", onClick);
    return b;
  }
  function back() { return st.step > 1 && !st.done ? btn("Back", function () { go(st.step - 1); }, "btn-ghost") : null; }
  function errorLine() { return st.error ? h("p", { class: "form-error", role: "alert", text: st.error }) : null; }
  function field(label, control, hint, wide) {
    var id = "f-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
    control.id = id;
    return h("div", { class: "field" + (wide ? " wide" : "") }, [h("label", { for: id, text: label }), control, hint ? h("span", { class: "hint", text: hint }) : null]);
  }
  function input(key, max, placeholder) {
    var el = h("input", { class: "input", type: "text", maxlength: String(max), placeholder: placeholder || null });
    el.value = st.f[key];
    el.addEventListener("input", function () { st.f[key] = el.value; });
    return el;
  }
  function area(key, max, rows, placeholder) {
    var el = h("textarea", { class: "textarea", maxlength: String(max), rows: String(rows), placeholder: placeholder || null });
    el.value = st.f[key];
    el.addEventListener("input", function () { st.f[key] = el.value; });
    return el;
  }
  function select(options, value, onChange) {
    var el = h("select", { class: "select" }, options.map(function (o) { return h("option", { value: o, text: o }); }));
    el.value = value;
    el.addEventListener("change", function () { onChange(el.value); });
    return el;
  }
  function licenseName() {
    var l = st.info && st.info.license;
    return !l ? "None found" : l.spdx || "Custom license";
  }
  function payload(dryRun) {
    return {
      repo: st.repo, intent: st.intent, status: st.status, title: st.f.title, kind: st.f.kind, genre: st.f.genre,
      base_game: st.f.base_game, tech: st.f.tech, browser: st.f.browser, note: st.f.note, rating: st.rating,
      content_notes: NOTES.filter(function (n) { return st.notes[n]; }), assets_license: st.assets,
      name_rights: st.intent === "leave" ? st.nameRights : null, open_to_transfer: st.intent === "leave" && st.transfer,
      works: st.f.works, broken: st.f.broken, vision: st.f.vision, agent_context: st.f.agent_context,
      provenance: st.prov, agreed: st.agreed, dry_run: !!dryRun
    };
  }
  function fail(res) {
    var e = res.data || {};
    st.error = e.error === "invalid_fields" && e.fields
      ? "Please check: " + e.fields.join(", ").replace(/_/g, " ") + "."
      : BC.errorText(e.error);
    st.busy = false;
    render();
  }

  // ----- steps -----
  function stepStart() {
    var out = [
      h("h2", { text: "Are you stepping away, or staying on?" }),
      BC.choices("Your plans for the project", [
        { value: "stay", label: "Staying on", desc: "I'm keeping the project and want collaborators or testers." },
        { value: "leave", label: "Stepping away", desc: "I'm moving on; someone else can adopt it." }
      ], st.intent, function (v) { st.intent = v; st.status = v === "leave" ? "adopt" : "help"; if (v !== "leave") st.transfer = false; render(); })
    ];
    if (st.user) {
      out.push(h("p", { text: "Signed in as @" + st.user.handle + ". Next, choose the repository to list." }));
      out.push(h("div", { class: "actions" }, [btn("Choose a repository", function () { go(2); loadRepos(); })]));
    } else {
      out.push(h("h3", { text: "Sign in with GitHub" }));
      out.push(h("p", { text: "Brainchild uses your GitHub account to prove you own the project. We only ask GitHub which public repositories you can manage; we never push to them, and we never see your email address." }));
      out.push(h("div", { class: "actions" }, [h("a", { class: "btn btn-light", href: "/api/auth/login?return_to=" + encodeURIComponent("/list.html?intent=" + st.intent), text: "Continue with GitHub" })]));
    }
    return out;
  }

  function loadRepos() {
    if (st.repos) return;
    BC.api("GET", "/api/my/repos").then(function (res) {
      if (!res.ok) { st.repos = []; return fail(res); }
      st.repos = res.data.repos || [];
      render();
    });
  }

  function stepRepo() {
    var list;
    if (!st.repos) list = h("p", { class: "muted", text: "Asking GitHub for your repositories…" });
    else if (!st.repos.length) list = h("p", { class: "muted", text: "GitHub didn't return any public repositories. You can type an address below." });
    else list = BC.choices("Your repositories", st.repos.map(function (r) {
      var ok = r.admin && !r.listed;
      return { value: r.full_name, label: r.full_name, mono: true, desc: r.description || (r.fork ? "Fork" : ""), disabled: !ok,
        extra: h("span", { class: "pill" + (ok ? "" : " warn"), text: r.listed ? "Already listed" : r.admin ? "Admin" : "No admin rights · can't list" }) };
    }), st.repo, function (v) { st.repo = v; st.manual = ""; render(); }, "stack");
    var manual = h("input", { class: "input", type: "text", placeholder: "owner/name", maxlength: "220" });
    manual.value = st.manual;
    manual.addEventListener("input", function () { st.manual = manual.value; });
    return [
      h("h2", { text: "Choose the project to list" }),
      h("p", { text: "Only public repositories where you have admin rights can be listed." }),
      list,
      field("Not in the list? Enter its GitHub address", manual, "For example: your-name/your-project"),
      errorLine(),
      h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "Check ownership", checkRepo, null, st.busy), back()])
    ];
  }

  function checkRepo() {
    var name = (st.manual.trim() || st.repo).replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) { st.error = "Choose a repository, or enter one as owner/name."; return render(); }
    st.busy = true; st.error = ""; render();
    var parts = name.split("/");
    BC.api("GET", "/api/repos/" + encodeURIComponent(parts[0]) + "/" + encodeURIComponent(parts[1]) + "/listing-info").then(function (res) {
      if (!res.ok) return fail(res);
      st.busy = false;
      st.info = res.data;
      st.repo = res.data.repo.full_name;
      st.preview = null;
      // Fill in what we can from the repo, without overwriting anything the maker typed.
      var title = (res.data.repo.name || "").replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 80);
      var agent = res.data.agent_file ? res.data.agent_file.text : "";
      if (!st.f.title || st.f.title === st.auto.title) st.f.title = title;
      if (!st.f.agent_context || st.f.agent_context === st.auto.agent) st.f.agent_context = agent;
      st.auto = { title: title, agent: agent };
      go(3);
    });
  }

  function stepOwnership() {
    var i = st.info, where = "github.com/" + i.repo.full_name;
    if (i.listed && !i.can_update) {
      return [h("h2", { text: "Ownership check" }),
        h("div", { class: "callout bad" }, [h("span", { class: "mark", "aria-hidden": "true", text: "!" }), h("div", null, [
          h("p", null, [h("strong", { text: "Already listed" })]),
          h("p", null, [where + " is already on Brainchild. ", h("a", { href: "project.html?id=" + encodeURIComponent(i.listed), text: "See its page" }), "."])])]),
        h("div", { class: "actions" }, [back()])];
    }
    if (!i.can_list) {
      return [h("h2", { text: "Ownership check" }),
        h("div", { class: "callout bad" }, [h("span", { class: "mark", "aria-hidden": "true", text: "×" }), h("div", null, [
          h("p", null, [h("strong", { text: "Not verified" })]),
          h("p", { text: i.repo.private ? where + " is private. Only public repositories can be listed." : "GitHub says @" + st.user.handle + " doesn't have admin rights on " + where + ". Ask an admin of the repository to list it." })])]),
        h("div", { class: "actions" }, [back()])];
    }
    return [
      h("h2", { text: "Ownership check" }),
      h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "✓" }), h("div", null, [
        h("p", null, [h("strong", { text: "Verified: @" + st.user.handle + " has admin rights on " + where })]),
        h("p", { text: "GitHub confirmed this just now, and Brainchild asks again when you publish. You'll show as a verified owner on the project page." })])]),
      i.listed ? h("p", { text: "This project already has a page on Brainchild from before sign-in existed. Publishing here updates that page and adds its license record; it doesn't create a second listing." }) : null,
      h("p", { class: "muted", text: "Why this matters: nobody can list your project, or claim to be you, without control of the repository." }),
      h("div", { class: "actions" }, [btn("Continue to license", function () { go(4); }), back()])
    ];
  }

  function stepLicense() {
    var lic = st.info.license, name = licenseName(), leaving = st.intent === "leave";
    var note = !lic ? ["bad", "No license: nobody can legally continue this project. Add a LICENSE file to your repo, then check again."]
      : !lic.spdx ? ["amber", "GitHub found a license file but doesn't recognise it as a standard license. It will be listed as a custom license; people will need to read it."]
      : LICENSE_NOTES[lic.spdx] || (/^(GPL|AGPL|LGPL)-/.test(lic.spdx) ? ["good", "Accepted. Future versions must stay under this license."] : ["good", "Accepted."]);
    var out = [
      h("h2", { text: "License and handoff snapshot" }),
      h("div", { class: "form-grid" }, [
        h("div", { class: "callout plain" }, [
          h("p", { class: "muted", style: "font-size:13px", text: lic ? "Code license (found in " + lic.path + ")" : "Code license" }),
          h("p", null, [h("strong", { style: "font-size:22px", text: name })]),
          h("p", { class: note[0] === "bad" ? "form-error" : null, text: note[1] })
        ]),
        field("Art, music and other assets", select(["CC BY 4.0", "CC BY-SA 4.0", "CC0", "Same as the code"], st.assets, function (v) { st.assets = v; st.preview = null; }),
          "CC BY 4.0 is recommended: others may reuse the assets if they credit you.")
      ])
    ];
    if (!lic) {
      out.push(errorLine());
      out.push(h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "Check again", checkRepo, null, st.busy), back()]));
      return out;
    }
    out.push(h("div", { class: "callout plain" }, [
      h("p", null, [h("strong", { text: "Snapshot Brainchild will keep" })]),
      h("ul", null, [
        h("li", { text: "The latest commit on " + (st.info.repo.default_branch || "the default branch") + ", noted at the moment you publish" }),
        h("li", { text: "A copy of the " + lic.path + " file at that commit, with a fingerprint so anyone can check it later" })
      ])
    ]));
    if (st.info.repo.fork) out.push(h("p", { class: "muted", text: "This repository is a fork of " + (st.info.repo.parent || "another project") + ". Only list it if you have the right to release it under this license." }));
    if (leaving) {
      out.push(h("fieldset", null, [
        h("legend", { text: "Can adopters keep the project's name?" }),
        h("p", { text: "Licenses cover the code, not the name. Apache-2.0 says outright that it grants no name rights, so say what you want here." }),
        BC.choices("Name rights", [
          { value: "keep", label: "Yes, keep it", desc: "Adopters can use the name as-is." },
          { value: "continuation", label: "Yes, as a continuation", desc: "The original name plus a subtitle of their own." },
          { value: "rename", label: "No, rename it", desc: "Adopters choose a new name and credit the original." }
        ], st.nameRights, function (v) { st.nameRights = v; st.preview = null; render(); })
      ]));
    }
    var agree = h("input", { type: "checkbox" });
    agree.checked = st.agreed;
    agree.addEventListener("change", function () { st.agreed = agree.checked; render(); });
    out.push(h("label", { class: "check-row" }, [agree, h("span", { text: "I own this project, and I release this version under the licenses above so that others can continue it. I understand this can't be withdrawn for this version." })]));
    out.push(h("div", { class: "actions" }, [btn("Continue", function () { go(5); }, null, !st.agreed), back()]));
    return out;
  }

  function stepDetails() {
    var isMod = st.f.kind === "Mod";
    var browser = h("input", { type: "checkbox" });
    browser.checked = st.f.browser;
    browser.addEventListener("change", function () { st.f.browser = browser.checked; });
    var prov = h("div", { class: "field wide" }, [h("label", { text: "Where each part came from" })].concat(st.prov.map(function (row, i) {
      var part = h("input", { class: "input", type: "text", maxlength: "80", placeholder: "Part (Code, Art, Music…)", "aria-label": "Part " + (i + 1) });
      var how = h("input", { class: "input", type: "text", maxlength: "200", placeholder: "How it was made, with which tools, under which license", "aria-label": "How part " + (i + 1) + " was made" });
      part.value = row.part; how.value = row.how;
      part.addEventListener("input", function () { row.part = part.value; });
      how.addEventListener("input", function () { row.how = how.value; });
      return h("div", { class: "prov-row" }, [part, how, btn("Remove", function () { st.prov.splice(i, 1); render(); }, "btn-ghost")]);
    })).concat([h("div", null, [btn("Add a part", function () { if (st.prov.length < 30) { st.prov.push({ part: "", how: "" }); render(); } }, "btn-ghost")])]));
    return [
      h("h2", { text: "About the project" }),
      h("div", { class: "form-grid" }, [
        field("Title", input("title", 80)),
        field("Type", select(["Game", "Mod", "App"], st.f.kind, function (v) { st.f.kind = v; st.preview = null; render(); })),
        field("Genre", select(D.genres, st.f.genre, function (v) { st.f.genre = v; })),
        isMod ? field("Base game", input("base_game", 80, "For example: Luanti"), "Mods need their base game. Your license covers only your own files; the game's own terms still apply.") : null,
        field("Built with", input("tech", 60, "For example: Godot 4"), "Optional."),
        isMod ? null : h("div", { class: "field" }, [h("label", { class: "check-list" }, [browser, h("span", { text: "It runs in a web browser" })])]),
        field("One-line description", input("note", 200, "What it is and where it stands"), "Shown on the project card. 200 characters at most.", true)
      ]),
      h("h3", { text: "Handoff packet" }),
      h("p", { text: "What the next person needs to pick this up. Be honest about what's broken; it saves them days." }),
      h("div", { class: "form-grid" }, [
        field("What works", area("works", 2000, 4, "One point per line: what's playable, how to build and run it"), "Required.", true),
        field("What's broken", area("broken", 2000, 4, "Known bugs, dead ends, fixes already tried"), null, true),
        field("What you were going for", area("vision", 2000, 3, "The feel, the endgame, what you'd build next"), null, true),
        field("Agent context file (CLAUDE.md or AGENTS.md)", area("agent_context", 20000, 6), st.info.agent_file ? "Filled in from " + st.info.agent_file.path + " in your repository. Edit it if you like." : "Paste the file your AI coding tool reads, if you have one.", true),
        prov
      ]),
      errorLine(),
      h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "Continue", toPublish, null, st.busy), back()])
    ];
  }

  // Ask the server to check everything and write the handoff rules, without saving yet.
  function toPublish() {
    st.busy = true; st.error = ""; render();
    BC.api("POST", "/api/projects", payload(true)).then(function (res) {
      if (!res.ok) return fail(res);
      st.busy = false;
      st.preview = res.data;
      go(6);
    });
  }

  function stepPublish() {
    var leaving = st.intent === "leave", p = st.preview, s = p.summary;
    var statusOpts = leaving
      ? [{ value: "adopt", label: "Up for adoption", desc: "You're stepping away; someone can take over." }]
      : [{ value: "help", label: "Open for collaboration", desc: "You're staying, and want people to join in." },
         { value: "test", label: "Needs testers", desc: "It works; you need people to play it and report back." }];
    var out = [h("h2", { text: leaving ? "Hand it off" : "How can people help?" }),
      BC.choices("Status", statusOpts, st.status, function (v) { st.status = v; render(); })];
    if (leaving) {
      var t = h("input", { type: "checkbox" });
      t.checked = st.transfer;
      t.addEventListener("change", function () { st.transfer = t.checked; render(); });
      out.push(h("label", { class: "check-row" }, [t, h("span", null, [h("strong", { text: "I'm open to transferring the repo" }), h("br"),
        h("span", { class: "muted", text: "If someone adopts it, you can move the repository to them on GitHub, keeping its stars, issues and links. Otherwise they'll fork it." })])]));
    }
    out.push(h("fieldset", null, [
      h("legend", { text: "Content rating" }),
      BC.choices("Content rating", [
        { value: "everyone", label: "Everyone", desc: "Nothing that would worry a parent." },
        { value: "teen", label: "Teen", desc: "Mild violence, scares or language." },
        { value: "mature", label: "Mature", desc: "Strong violence, gore, horror or language. Shown behind a warning." }
      ], st.rating, function (v) { st.rating = v; render(); }),
      h("p", { text: "Content notes (tick any that apply)" }),
      h("div", { class: "check-list" }, NOTES.map(function (n) {
        var c = h("input", { type: "checkbox" });
        c.checked = !!st.notes[n];
        c.addEventListener("change", function () { st.notes[n] = c.checked; render(); });
        return h("label", null, [c, h("span", { text: n === "Historical symbols" ? "Historical symbols (for example in WW2 strategy mods)" : n })]);
      })),
      h("p", { class: "muted", style: "font-size:14px", text: "Sexually explicit content isn't allowed on Brainchild at any rating, including mods (for example, nude mods)." })
    ]));
    var ticked = NOTES.filter(function (n) { return st.notes[n]; });
    var nameNote = !leaving ? "stays with the maintainer" : { keep: "adopters may keep it", continuation: "keep it, marked as a continuation", rename: "adopters must rename" }[st.nameRights];
    out.push(h("div", { class: "callout plain" }, [
      h("p", { class: "muted", style: "font-size:13px", text: "How it will appear on the project page" }),
      h("p", null, [h("strong", { text: s.title }), " · ✓ Verified owner @" + s.owner + " · Released under " + (s.license || "a custom license") + " at commit " + s.commit.slice(0, 7) + " on " + BC.niceDate(s.date) +
        " · Name: " + nameNote + " · Rated " + { everyone: "Everyone", teen: "Teen", mature: "Mature" }[st.rating] + (ticked.length ? " (" + ticked.join(", ").toLowerCase() + ")" : "") + (leaving && st.transfer ? " · Open to transfer" : "")])
    ]));
    out.push(BC.rulesBlock("Added to the handoff packet: rules for the AI", p.rules,
      "Generated from your answers. Adopters are asked to add it to their agent context file, so their AI tools follow your license and name rules every session."));
    out.push(errorLine());
    out.push(h("div", { class: "actions" }, [btn(st.busy ? "Publishing…" : leaving ? "Publish and hand it off" : "Publish and invite collaborators", publish, null, st.busy), back()]));
    return out;
  }

  function publish() {
    st.busy = true; st.error = ""; render();
    BC.api("POST", "/api/projects", payload(false)).then(function (res) {
      if (!res.ok) return fail(res);
      st.busy = false;
      st.done = res.data;
      render();
      window.scrollTo(0, 0);
    });
  }

  function stepDone() {
    var d = st.done, id = encodeURIComponent(d.id);
    return [
      h("h2", { text: "It's listed" }),
      h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "✓" }), h("div", null, [
        h("p", null, [h("strong", { text: d.summary.title + " is now on Brainchild." })]),
        h("p", { text: "Released under " + (d.summary.license || "a custom license") + " at commit " + d.summary.commit.slice(0, 7) + " on " + BC.niceDate(d.summary.date) + ". This release is recorded and can't be withdrawn." })])]),
      BC.rulesBlock("Rules for the AI, kept in the handoff packet", d.rules, "Add this section to CLAUDE.md or AGENTS.md in your repository too, so it travels with the code."),
      h("div", { class: "actions" }, [
        h("a", { class: "btn btn-primary", href: "project.html?id=" + id, text: "Go to the project page" }),
        h("a", { class: "btn btn-ghost", href: "license.html?id=" + id, text: "See the license record" })
      ])
    ];
  }

  function render() {
    var leaving = st.intent === "leave";
    document.getElementById("w-title").textContent = leaving ? "Pass it on, safely." : "Bring people in.";
    BC.renderSteps(document.getElementById("w-rail"), STEPS, st.done ? STEPS.length + 1 : st.step);
    var parts = st.done ? stepDone() : [stepStart, stepRepo, stepOwnership, stepLicense, stepDetails, stepPublish][st.step - 1]();
    body.textContent = "";
    parts.forEach(function (p) { if (p) body.appendChild(p); });
  }

  if (window.location.protocol === "file:") { body.textContent = "This page only works on the live site."; return; }
  BC.whoAmI().then(function (user) {
    st.user = user;
    if (st.intent === "leave") st.status = "adopt";
    render();
  });
})();
