/* List a project: the maker's side of a handoff. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, D = window.BC_DATA;
  var body = document.getElementById("w-body");
  var STEPS = ["Start", "Choose repo", "Ownership", "License", "Details", "Publish"];
  var NOTES = ["Violence", "Blood", "Horror", "Strong language", "Drug references", "Gambling-style mechanics"];
  var LICENSE_NOTES = {
    "MIT": ["amber", "Accepted. MIT works for handing off. Apache-2.0 and GPLv3 go further and state in writing that the permission is permanent, if you'd like that certainty."],
    "Apache-2.0": ["good", "Recommended: the license states its permissions are perpetual and irrevocable. It grants no rights to the project's name, so the name question below matters."],
    "GPL-3.0": ["good", "Recommended: irrevocable, and future versions must stay open too."]
  };
  // What each art license means, shown under the choice in step 4.
  var ART_HINTS = {
    "CC BY 4.0": "Anyone may use, change and share the art, even to sell, as long as they credit you. This lets the most people continue the project.",
    "CC BY-SA 4.0": "Anyone may use, change and share the art, even to sell, with credit, and changed art must stay CC BY-SA. It can't be mixed with CC BY-NC-SA art.",
    "CC0": "You give up your rights to the art as far as the law allows: anyone may use it for anything, without crediting you.",
    "CC BY-NC 4.0": "People may change the art and continue the project, with credit, but not sell it. The project shows a \"Non-commercial art\" label.",
    "CC BY-NC-SA 4.0": "People may change the art and continue the project, with credit, but not sell it, and changed art stays CC BY-NC-SA. It can't be mixed with CC BY-SA art. The project shows a \"Non-commercial art\" label.",
    "Same as the code": "The art goes under the code's license. Code licenses are written for code, so a Creative Commons license usually fits art better."
  };
  // The short guide to choosing, always shown under the art license's own description.
  var ART_GUIDE = [
    ["Want the most people able to continue and remix it?", "CC BY 4.0 (the default)."],
    ["Want every changed version to stay open too?", "CC BY-SA 4.0."],
    ["Don't want anyone selling it?", "CC BY-NC-SA 4.0, which keeps changes open on the same terms, or CC BY-NC 4.0."],
    ["Don't need credit at all?", "CC0."]
  ];
  function withArtGuide(el) {
    el.appendChild(h("ul", { class: "hint art-guide", "aria-label": "Which art license to choose" },
      ART_GUIDE.map(function (g) { return h("li", null, [h("strong", { text: g[0] }), " " + g[1]]); })));
    return el;
  }
  // What the server's field names are called on screen, with the step they're on.
  var FIELD_LABELS = {
    repo: "Repository (step 2)", title: "Title (step 5)", kind: "Type (step 5)", genre: "Genre (step 5)",
    base_game: "Made for (step 5)", tech: "Built with (step 5)", note: "One-line description (step 5)",
    works: "What works (step 5)", broken: "What's broken (step 5)", vision: "What you were going for (step 5)",
    agent_context: "Agent context file (step 5)", provenance: "Where the parts came from (step 5)",
    assets_license: "Art, music and other assets license (step 4)", name_rights: "The project name question (step 4)",
    status: "Status (step 6)", rating: "Content rating (step 6)", content_notes: "Content notes (step 6)",
    agreed: "The agreement checkbox (step 6)"
  };
  var params = new URLSearchParams(window.location.search);
  var st = {
    step: 1, user: null, intent: params.get("intent") === "leave" ? "leave" : "stay",
    host: ["gitlab", "selfhosted"].includes(params.get("host")) ? params.get("host") : "github", reauth: "", code: null,
    repos: null, repo: "", manual: params.get("repo") || "", info: null, error: "", busy: false,
    assets: "CC BY 4.0", nameRights: "continuation", agreed: false,
    f: { title: "", kind: "Game", genre: D.genres[0], base_game: "", tech: "", browser: false, note: "", works: "", broken: "", vision: "", agent_context: "" },
    prov: [{ part: "Code", how: "" }, { part: "Art", how: "" }, { part: "Audio", how: "" }],
    auto: { title: "", agent: "" }, licAnswer: null, copied: "", status: "help", transfer: false, rating: "everyone", notes: {}, preview: null, done: null
  };

  var HOST = { github: "GitHub", gitlab: "GitLab", selfhosted: "your GitLab" };
  function hostName() { return HOST[st.host]; }
  function roleName() { return st.host === "gitlab" ? "the Maintainer or Owner role" : st.host === "selfhosted" ? "push access" : "admin rights"; }
  function here() { return "/list.html?intent=" + st.intent + "&host=" + st.host; }
  // Signing in, or connecting the other site to the account you're signed in with.
  function connectHref(host, link) {
    return host === "gitlab" ? "/api/auth/gitlab/login?" + (link ? "link=1&" : "") + "return_to=" + encodeURIComponent(here())
      : "/api/auth/login?provider=github&" + (link ? "link=1&" : "") + "return_to=" + encodeURIComponent(here());
  }
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
    var el = h("select", { class: "select" }, options.map(function (o) { return h("option", { value: o, text: BC.kindLabel(o) }); }));
    el.value = value;
    el.addEventListener("change", function () { onChange(el.value); });
    return el;
  }
  // The license as it will be listed: the host's name for it, Brainchild's match, or custom.
  function licenseName() {
    var l = st.info && st.info.license;
    if (!l) return "None found";
    if (l.spdx) return l.spdx;
    if (l.found && !(l.extra || []).length) return l.found;
    if (l.found && st.licAnswer === "explains") return l.found + ", with a note";
    if (l.found && !st.licAnswer) return l.found + " text, plus extra wording";
    return "Custom license";
  }
  function needsAnswer() { var l = st.info && st.info.license; return !!(l && !l.spdx && l.found && (l.extra || []).length && !st.licAnswer); }
  function payload(dryRun) {
    return {
      repo: st.info && st.host === "gitlab" ? String(st.info.repo.id) : st.info && st.host === "selfhosted" ? st.info.repo.url : st.repo, host: st.host, intent: st.intent, status: st.status, title: st.f.title, kind: st.f.kind, genre: st.f.genre,
      base_game: st.f.base_game, tech: st.f.tech, browser: st.f.browser, note: st.f.note, rating: st.rating,
      content_notes: NOTES.filter(function (n) { return st.notes[n]; }), assets_license: st.assets,
      name_rights: st.intent === "leave" ? st.nameRights : null, open_to_transfer: st.intent === "leave" && st.transfer,
      works: st.f.works, broken: st.f.broken, vision: st.f.vision, agent_context: st.f.agent_context,
      provenance: st.prov, agreed: st.agreed, dry_run: !!dryRun,
      license_answer: st.licAnswer && st.info && st.info.license ? { fingerprint: st.info.license.fingerprint, answer: st.licAnswer } : null
    };
  }
  function fail(res) {
    var e = res.data || {};
    if (e.error === "github_sign_in_again" || e.error === "gitlab_sign_in_again") { st.reauth = e.error === "gitlab_sign_in_again" ? "gitlab" : "github"; st.busy = false; return render(); }
    // The LICENSE file changed since step 4 and has wording to ask about: back to the license step.
    if (e.error === "license_question" && e.license && st.info) { st.info.license = e.license; st.licAnswer = null; st.agreed = false; st.busy = false; return go(4); }
    st.error = e.error === "invalid_fields" && e.fields
      ? "Please fill in or fix: " + e.fields.map(function (k) { return FIELD_LABELS[k] || k.replace(/_/g, " "); }).join(", ") + "."
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
      out.push(h("h3", { text: "Sign in where your project lives" }));
      out.push(h("p", { text: "Brainchild uses your GitHub or GitLab account to prove you manage the project. It only reads which public repositories you can manage; it never changes anything there, and it never sees your email address." }));
      out.push(h("div", { class: "actions" }, [
        h("a", { class: "btn btn-light", href: connectHref("github", false), text: "Continue with GitHub" }),
        h("a", { class: "btn btn-light", href: "/api/auth/gitlab/login?return_to=" + encodeURIComponent("/list.html?intent=" + st.intent + "&host=gitlab"), text: "Continue with GitLab" })]));
    }
    return out;
  }

  function loadRepos() {
    if (st.repos) return;
    BC.api("GET", "/api/my/repos?host=" + st.host).then(function (res) {
      if (!res.ok) { st.repos = []; return fail(res); }
      st.repos = res.data.repos || [];
      render();
    });
  }

  function stepRepo() {
    var list;
    var picker = h("div", null, [h("p", { class: "muted", style: "margin:0 0 8px", text: "Where the project lives" }), BC.choices("Where the project lives", [
      { value: "github", label: "GitHub" }, { value: "gitlab", label: "GitLab.com" }, { value: "selfhosted", label: "Self-hosted GitLab" }
    ], st.host, function (v) { if (v === st.host) return; st.host = v; st.repos = null; st.repo = ""; st.manual = ""; st.info = null; st.reauth = ""; st.code = null; st.error = ""; render(); if (v !== "selfhosted") loadRepos(); })]);
    if (st.host === "selfhosted") return selfHostedStep(picker);
    if (st.reauth === st.host) {
      return [h("h2", { text: "Choose the project to list" }), picker,
        h("div", { class: "callout plain" }, [
          h("p", null, [h("strong", { text: "Connect your " + hostName() + " account" })]),
          h("p", { text: "To check that you manage a " + hostName() + " project, Brainchild needs you to sign in to " + hostName() + " from this account. It stays linked, so you can sign in with either account afterwards." }),
          h("div", { class: "actions" }, [h("a", { class: "btn btn-light", href: connectHref(st.host, true), text: "Connect " + hostName() })])]),
        h("div", { class: "actions" }, [back()])];
    }
    if (!st.repos) list = h("p", { class: "muted", text: "Asking " + hostName() + " for your repositories…" });
    else if (!st.repos.length) list = h("p", { class: "muted", text: hostName() + " didn't return any public repositories you manage. You can type an address below." });
    else list = BC.choices("Your repositories", st.repos.map(function (r) {
      var ok = r.admin && !r.listed;
      return { value: r.full_name, label: r.full_name, mono: true, desc: r.description || (r.fork ? "Fork" : ""), disabled: !ok,
        extra: h("span", { class: "pill" + (ok ? "" : " warn"), text: r.listed ? "Already listed" : r.admin ? (st.host === "gitlab" ? "Maintainer" : "Admin") : "No admin rights · can't list" }) };
    }), st.repo, function (v) { st.repo = v; st.manual = ""; render(); }, "stack");
    var manual = h("input", { class: "input", type: "text", placeholder: st.host === "gitlab" ? "group/project" : "owner/name", maxlength: "220" });
    manual.value = st.manual;
    manual.addEventListener("input", function () { st.manual = manual.value; });
    return [
      h("h2", { text: "Choose the project to list" }),
      picker,
      h("p", { text: "Only public repositories where you have " + roleName() + " can be listed. Codeberg isn't supported." }),
      list,
      field("Not in the list? Enter its " + hostName() + " address", manual, st.host === "gitlab" ? "For example: your-name/your-project, or a group/subgroup/project path" : "For example: your-name/your-project"),
      errorLine(),
      h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "Check ownership", checkRepo, null, st.busy), back()])
    ];
  }

  // Self-hosted GitLab: Brainchild can't sign in there, so the maker commits a code to the repository.
  function selfHostedStep(picker) {
    var addr = h("input", { class: "input", type: "url", id: "sh-url", placeholder: "https://git.example.org/your-group/your-project", maxlength: "300" });
    addr.value = st.manual;
    addr.addEventListener("input", function () { st.manual = addr.value; st.code = null; });
    var out = [h("h2", { text: "Choose the project to list" }), picker,
      h("p", { text: "On your own GitLab, you prove you can push to the project by committing a short code Brainchild gives you. The project has to be public. Its page will say \"verified: push access\"." }),
      field("The project's address", addr, "The full address you'd open in a browser.")];
    if (!st.code) {
      out.push(errorLine());
      out.push(h("div", { class: "actions" }, [btn(st.busy ? "Getting a code…" : "Get a verification code", function () {
        st.busy = true; st.error = ""; render();
        BC.api("POST", "/api/verify-code", { url: st.manual.trim() }).then(function (res) {
          st.busy = false;
          if (!res.ok) return fail(res);
          st.code = res.data; render();
        });
      }, null, st.busy), back()]));
      return out;
    }
    var c = st.code;
    out.push(h("div", { class: "callout plain" }, [
      h("p", null, [h("strong", { text: "Commit this code to " + c.path + " on " + c.host.slice(11) })]),
      h("ol", null, [
        h("li", null, ["Create a file called ", h("code", { text: c.file }), " at the top of the default branch."]),
        h("li", null, ["Put this in it, and nothing else:"]),
      ]),
      h("pre", { class: "code-block", text: c.code }),
      h("p", { class: "muted", text: "Use it within " + c.days + " days. Keep the file in the repository: Brainchild reads it again whenever you edit the page. Handing the project off later needs a new code." })]));
    out.push(errorLine());
    out.push(h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "I've committed it: check", checkRepo, null, st.busy),
      btn("Get a different code", function () { st.code = null; render(); }, "btn-ghost"), back()]));
    return out;
  }

  function checkRepo() {
    if (st.host === "selfhosted") {
      st.busy = true; st.error = ""; render();
      return BC.api("GET", "/api/listing-info?host=selfhosted&repo=" + encodeURIComponent(st.manual.trim())).then(afterInfo);
    }
    var raw = st.manual.trim() || st.repo;
    if (/codeberg\.org/i.test(raw)) { st.error = BC.errorText("codeberg_not_supported"); return render(); }
    var name = raw.replace(/^https?:\/\/(www\.)?(github|gitlab)\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
    var okName = st.host === "gitlab" ? /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+){1,5}$/.test(name) : /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name);
    if (!okName) { st.error = "Choose a repository, or enter one as " + (st.host === "gitlab" ? "group/project" : "owner/name") + "."; return render(); }
    st.busy = true; st.error = ""; render();
    BC.api("GET", "/api/listing-info?host=" + st.host + "&repo=" + encodeURIComponent(name)).then(afterInfo);
  }

  function afterInfo(res) {
    (function () {
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
      // Handing off a project that is already listed: start from what its page says now.
      if (res.data.listed && res.data.can_hand_off) {
        return BC.api("GET", "/api/projects/" + encodeURIComponent(res.data.listed) + "?t=" + Date.now()).then(function (cur) {
          if (cur.ok) {
            var c = cur.data.project, k = cur.data.packet || {};
            st.f = { title: c.title || "", kind: c.kind, genre: c.genre, base_game: c.base_game || "", tech: c.tech || "", browser: !!c.browser, note: c.note || "",
              works: k.works || "", broken: k.broken || "", vision: k.vision || "", agent_context: k.agent_context || agent };
            if (Array.isArray(k.provenance) && k.provenance.length) st.prov = k.provenance.map(function (x) { return { part: String(x.part || ""), how: String(x.how || "") }; });
            st.rating = c.rating || "everyone";
            st.notes = {};
            (c.content_notes || []).forEach(function (n) { st.notes[n] = true; });
            if (c.assets_license) st.assets = c.assets_license;
          }
          go(3);
        });
      }
      go(3);
    })();
  }

  function stepOwnership() {
    var i = st.info, where = BC.repoWhere(i.repo.host, i.repo.full_name);
    if (i.listed && i.can_hand_off && st.intent !== "leave") {
      return [h("h2", { text: "Ownership check" }),
        h("div", { class: "callout plain" }, [
          h("p", null, [h("strong", { text: "This project is already listed, and you maintain it." })]),
          h("p", null, ["To change its page, ", h("a", { href: "edit.html?id=" + encodeURIComponent(i.listed), text: "edit the page" }), ". To hand it off, go back to step 1 and choose \"Stepping away\"."])]),
        h("div", { class: "actions" }, [btn("Back to step 1", function () { go(1); }, "btn-ghost")])];
    }
    if (i.listed && !i.can_update && !i.can_hand_off) {
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
          h("p", { text: i.repo.private ? where + " is private. Only public repositories can be listed." : (i.verify_error ? BC.errorText(i.verify_error) + " (" + where + ") " : hostName() + " says @" + st.user.handle + " doesn't have " + roleName() + " on " + where + ". ") + (i.verify_error ? "" : "Ask an admin of the repository to list it.") })])]),
        h("div", { class: "actions" }, [back()])];
    }
    return [
      h("h2", { text: "Ownership check" }),
      h("div", { class: "callout" }, [h("span", { class: "mark", "aria-hidden": "true", text: "✓" }), h("div", null, [
        h("p", null, [h("strong", { text: "Verified: @" + st.user.handle + " has " + roleName() + " on " + where })]),
        h("p", { text: (st.host === "selfhosted" ? "Your code is in " + where + "; Brainchild read it just now" : hostName() + " confirmed this just now") + ", and Brainchild asks again when you publish. You'll show as a verified owner on the project page." })])]),
      i.listed && i.can_hand_off ? h("p", { text: "This project is already listed. Finishing these steps puts it up for adoption on the same page, with a new license snapshot; nothing is duplicated and its lineage stays." }) : null,
      i.listed && !i.can_hand_off ? h("p", { text: "This project already has a page on Brainchild from before sign-in existed. Publishing here updates that page and adds its license record; it doesn't create a second listing." }) : null,
      h("p", { class: "muted", text: "Why this matters: nobody can list your project, or claim to be you, without control of the repository." }),
      h("div", { class: "actions" }, [btn("Continue to license", function () { go(4); }), back()])
    ];
  }

  function stepLicense() {
    var lic = st.info.license, name = licenseName(), leaving = st.intent === "leave";
    var extra = lic && !lic.spdx && lic.found && (lic.extra || []).length;
    var known = lic && (lic.spdx || (lic.found && (!extra || st.licAnswer === "explains")) ? lic.spdx || lic.found : null);
    var note = !lic ? ["bad", "No license: nobody can legally continue this project. Add a LICENSE file to your repo, then check again."]
      : extra && !st.licAnswer ? ["amber", "Brainchild found the standard " + lic.found + " text in " + lic.path + ", with extra wording around it. Say below what that wording does."]
      : extra && st.licAnswer === "conditions" ? ["amber", "Listed as a custom license: the " + lic.found + " text with added conditions. The conditions will be shown on the project page and License record."]
      : !known ? ["amber", "Neither " + hostName() + " nor Brainchild recognises this as a standard license. You can still list it as a custom license, but people will need to read it; see below for the usual fix."]
      : !lic.spdx ? ["good", "Brainchild recognised the standard " + lic.found + " text, though " + hostName() + " didn't name it." + (st.licAnswer === "explains" ? " Your extra wording is kept on the License record as a note." : "")]
      : LICENSE_NOTES[lic.spdx] || (/^(GPL|AGPL|LGPL)-/.test(lic.spdx) ? ["good", "Accepted. Future versions must stay under this license."] : ["good", "Accepted."]);
    var out = [
      h("h2", { text: "License and handoff snapshot" }),
      h("div", { class: "form-grid" }, [
        h("div", { class: "callout plain" }, [
          h("p", { class: "muted", style: "font-size:13px", text: lic ? "Code license (found in " + lic.path + ")" : "Code license" }),
          h("p", null, [h("strong", { style: "font-size:22px", text: name })]),
          h("p", { class: note[0] === "bad" ? "form-error" : null, text: note[1] })
        ]),
        withArtGuide(field("Art, music and other assets", select(["CC BY 4.0", "CC BY-SA 4.0", "CC0", "CC BY-NC 4.0", "CC BY-NC-SA 4.0", "Same as the code"], st.assets, function (v) { st.assets = v; st.preview = null; render(); }),
          (ART_HINTS[st.assets] || "") + " No-derivatives (ND) licenses aren't accepted, because nobody could change the art."))
      ])
    ];
    if (extra) {
      out.push(BC.licenseQuestion({ found: lic.found, path: lic.path, extra: lic.extra }, st.licAnswer, function (v) { st.licAnswer = v; st.preview = null; render(); }));
    }
    if (!lic || !known && !extra) out.push(fixIt(lic));
    if (!lic) {
      out.push(errorLine());
      out.push(h("div", { class: "actions" }, [back()]));
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
    out.push(errorLine());
    out.push(h("div", { class: "actions" }, [btn("Continue", function () { go(5); }, null, !st.agreed || needsAnswer()), back()]));
    return out;
  }

  // When no standard license is recognised: what usually causes it, how to fix it in the repository,
  // and the standard texts to copy. Brainchild has no write access, so the maker makes the change.
  var COPY_TEXTS = [["MIT", "MIT"], ["Apache-2.0", "Apache 2.0"], ["GPL-3.0", "GPL 3.0"], ["MPL-2.0", "MPL 2.0"]];
  function copyButton(spdx, label) {
    var b = h("button", { class: "btn btn-ghost", type: "button", text: "Copy " + label });
    b.addEventListener("click", function () {
      fetch("/license-texts/" + spdx + ".txt").then(function (r) { return r.ok ? r.text() : null; }, function () { return null; }).then(function (t) {
        if (!t) { st.copied = "That text couldn't be loaded. Try again in a minute."; return render(); }
        t = t.replace(/\[year\]/g, String(new Date().getFullYear())).replace(/\[fullname\]/g, st.user ? st.user.handle : "Your name");
        var done = function (ok) {
          st.copied = ok ? "Copied the " + label + " text, with this year and your name filled in. Paste it into the file, commit it, then press Check again."
            : "Your browser didn't allow copying. Open /license-texts/" + spdx + ".txt and copy it from there.";
          render();
        };
        try { if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); }); else done(false); } catch (e) { done(false); }
      });
    });
    return b;
  }
  function fixIt(lic) {
    var several = lic && lic.several && lic.several.length;
    var cause = !lic ? "There's no LICENSE file in the repository, so nobody may legally continue the project."
      : several ? "Your " + lic.path + " file holds more than one license text (" + lic.several.join(" and ") + "). Each file should hold one."
      : "The usual cause is extra text inside the " + lic.path + " file, such as a note about what it covers or changed wording, or a file that isn't a standard license at all.";
    return h("div", { class: "callout plain fix-it" }, [
      h("p", null, [h("strong", { text: !lic ? "How to add a license" : "Why it isn't recognised, and how to fix it" })]),
      h("p", { text: cause }),
      h("p", { text: "The fix: keep LICENSE as the plain, unchanged text of one standard license. Put notes about what it covers in your README instead." }),
      h("p", { text: (lic ? "To replace" : "To add") + " it, copy a standard text below into a file called LICENSE in your repository:" }),
      h("div", { class: "actions" }, COPY_TEXTS.map(function (x) { return copyButton(x[0], x[1]); })),
      h("p", { text: "Different licenses for code and art? Put the code license in LICENSE and the art license in a separate file (for example LICENSE-ART.md), then choose the art license under \"Art, music and other assets\" on this step." }),
      h("div", { class: "actions" }, [copyButton("CC-BY-4.0", "CC BY 4.0 (for the art)"), copyButton("CC-BY-SA-4.0", "CC BY-SA 4.0 (for the art)")]),
      st.copied ? h("p", { role: "status", text: st.copied }) : null,
      h("p", { class: "muted", style: "font-size:14px", text: "Brainchild never gets write access to your repository, so it can't make this change for you. " }, [h("a", { href: "licenses.html#custom", text: "More in the licensing guide" })]),
      h("div", { class: "actions" }, [btn(st.busy ? "Checking…" : "Check again", recheckLicense, null, st.busy)])
    ]);
  }
  // Look at the repository's license again without leaving this step.
  function recheckLicense() {
    var ref = st.host === "gitlab" ? st.info.repo.full_name : st.host === "selfhosted" ? st.info.repo.url : st.repo;
    st.busy = true; st.error = ""; st.copied = ""; render();
    BC.api("GET", "/api/listing-info?host=" + st.host + "&repo=" + encodeURIComponent(ref)).then(function (res) {
      st.busy = false;
      if (!res.ok) return fail(res);
      var before = st.info.license && st.info.license.fingerprint;
      st.info = res.data;
      if (!st.info.license || st.info.license.fingerprint !== before) { st.licAnswer = null; st.agreed = false; }
      st.preview = null;
      render();
    });
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
        isMod ? field("Made for", input("base_game", 80, "For example: Darkest Hour, Firefox, VS Code"), "The game or program it runs in. Your license covers only your own files; the terms of what it's made for still apply.") : null,
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
      : [{ value: "help", label: "Open for collaboration", desc: "You're staying, and want people to join in. It can also be proposed as a community project on the Blog." },
         { value: "test", label: "Needs testers", desc: "It works; you need people to play it and report back. Projects that only need testers aren't offered as community projects on the Blog." }];
    var out = [h("h2", { text: leaving ? "Hand it off" : "How can people help?" }),
      BC.choices("Status", statusOpts, st.status, function (v) { st.status = v; render(); })];
    if (leaving) {
      var t = h("input", { type: "checkbox" });
      t.checked = st.transfer;
      t.addEventListener("change", function () { st.transfer = t.checked; render(); });
      out.push(h("label", { class: "check-row" }, [t, h("span", null, [h("strong", { text: "I'm open to transferring the repo" }), h("br"),
        h("span", { class: "muted", text: "If someone adopts it, you can move the repository to them on " + hostName() + ", keeping its stars, issues and links. Otherwise they'll fork it." })])]));
    }
    out.push(h("fieldset", null, [
      h("legend", { text: "Content rating" }),
      BC.choices("Content rating", [
        { value: "everyone", label: "Everyone", desc: "No violence beyond cartoon or slapstick, no blood, no swearing." },
        { value: "teen", label: "Teen", desc: "Combat and non-graphic violence, mild blood, horror themes and jump scares, moderate language, drug or alcohol references, war strategy." },
        { value: "mature", label: "Mature", desc: "Realistic or graphic violence and gore, strong language throughout, drug use shown, disturbing themes. Shown behind a warning. Sexual content isn't allowed at any rating." }
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
