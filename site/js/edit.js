/* Edit a project page (maintainer only). All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, D = window.BC_DATA, root = document.getElementById("m-body");
  var id = new URLSearchParams(window.location.search).get("id") || "";
  var NOTES = ["Violence", "Blood", "Horror", "Strong language", "Drug references", "Gambling-style mechanics", "Historical symbols"];
  var LABELS = { title: "Title", note: "One-line description", genre: "Genre", tech: "Built with", status: "Status", rating: "Content rating",
    content_notes: "Content notes", works: "What works", broken: "What's broken", vision: "What you were going for", agent_context: "Agent context file", provenance: "Where each part came from" };
  var f = null, p = null, msg = null, busy = false;

  function message(parts) { root.textContent = ""; root.appendChild(h("p", { class: "muted" }, parts)); }
  function field(label, control, hint, wide) {
    var fid = "e-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
    control.id = fid;
    return h("div", { class: "field" + (wide ? " wide" : "") }, [h("label", { for: fid, text: label }), control, hint ? h("span", { class: "hint", text: hint }) : null]);
  }
  function input(key, max) { var el = h("input", { class: "input", type: "text", maxlength: String(max) }); el.value = f[key]; el.addEventListener("input", function () { f[key] = el.value; }); return el; }
  function area(key, max, rows) { var el = h("textarea", { class: "textarea", maxlength: String(max), rows: String(rows) }); el.value = f[key]; el.addEventListener("input", function () { f[key] = el.value; }); return el; }
  function select(options, key) {
    var el = h("select", { class: "select" }, options.map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    el.value = f[key];
    el.addEventListener("change", function () { f[key] = el.value; });
    return el;
  }

  function save() {
    busy = true; msg = null; render();
    BC.api("POST", "/api/projects/" + encodeURIComponent(id) + "/edit", f).then(function (res) {
      busy = false;
      if (res.ok) {
        msg = { ok: true, text: res.data.changed.length ? "Saved. Changed: " + res.data.changed.join(", ") + "." : "Nothing was different, so nothing was saved." };
      } else {
        var e = res.data || {};
        msg = { ok: false, text: e.error === "invalid_fields" && e.fields ? "Please fill in or fix: " + e.fields.map(function (k) { return LABELS[k] || k; }).join(", ") + "."
          : e.error === "listing_not_verified" ? "List this project again through List a project first, so its repository is verified." : BC.errorText(e.error) };
      }
      render();
      window.scrollTo(0, 0);
    });
  }

  function render() {
    var isMod = p.kind === "Mod", pid = encodeURIComponent(id);
    var statuses = [["help", "Open for collaboration"], ["test", "Needs testers"], ["active", "Active"], ["archived", "Archived"]];
    if (p.status === "adopt") statuses.unshift(["adopt", "Up for adoption (as it is now)"]);
    var browser = h("input", { type: "checkbox" });
    browser.checked = f.browser;
    browser.addEventListener("change", function () { f.browser = browser.checked; });
    var prov = h("div", { class: "field wide" }, [h("label", { text: "Where each part came from" })].concat(f.provenance.map(function (row, i) {
      var part = h("input", { class: "input", type: "text", maxlength: "80", placeholder: "Part (Code, Art, Music…)", "aria-label": "Part " + (i + 1) });
      var how = h("input", { class: "input", type: "text", maxlength: "200", placeholder: "How it was made, with which tools, under which license", "aria-label": "How part " + (i + 1) + " was made" });
      part.value = row.part; how.value = row.how;
      part.addEventListener("input", function () { row.part = part.value; });
      how.addEventListener("input", function () { row.how = how.value; });
      var rm = h("button", { class: "btn btn-ghost", type: "button", text: "Remove" });
      rm.addEventListener("click", function () { f.provenance.splice(i, 1); render(); });
      return h("div", { class: "prov-row" }, [part, how, rm]);
    })));
    var add = h("button", { class: "btn btn-ghost", type: "button", text: "Add a part" });
    add.addEventListener("click", function () { if (f.provenance.length < 30) { f.provenance.push({ part: "", how: "" }); render(); } });
    prov.appendChild(h("div", null, [add]));
    var saveBtn = h("button", { class: "btn btn-primary", type: "button", text: busy ? "Saving…" : "Save changes", disabled: busy ? true : null });
    saveBtn.addEventListener("click", save);
    var repo = (p.repo_url || "").replace(/^https:\/\/github\.com\//, "");

    root.textContent = "";
    if (msg) root.appendChild(h("p", { class: msg.ok ? "callout plain" : "form-error", role: msg.ok ? "status" : "alert", text: msg.text }));
    root.appendChild(h("section", { class: "panel wizard" }, [
      h("h2", { text: "About the project" }),
      h("div", { class: "form-grid" }, [
        field("Title", input("title", 80)),
        field("Genre", select(D.genres.map(function (g) { return [g, g]; }), "genre")),
        field("Built with", input("tech", 60), "Optional."),
        isMod ? null : h("div", { class: "field" }, [h("label", { class: "check-list" }, [browser, h("span", { text: "It runs in a web browser" })])]),
        field("One-line description", input("note", 200), "Shown on the project card. 200 characters at most.", true)
      ]),
      h("h3", { text: "Status" }),
      h("div", { class: "form-grid" }, [field("Status", select(statuses, "status"),
        p.status === "adopt" ? "Choosing another status withdraws the project from adoption." : "To put the project up for adoption, use the link at the bottom of this page: handing off asks about the license and the name.")]),
      h("h3", { text: "Content rating" }),
      BC.choices("Content rating", [
        { value: "everyone", label: "Everyone", desc: "Nothing that would worry a parent." },
        { value: "teen", label: "Teen", desc: "Mild violence, scares or language." },
        { value: "mature", label: "Mature", desc: "Strong violence, gore, horror or language. Shown behind a warning." }
      ], f.rating, function (v) { f.rating = v; render(); }),
      h("div", { class: "check-list" }, NOTES.map(function (n) {
        var c = h("input", { type: "checkbox" });
        c.checked = f.content_notes.indexOf(n) >= 0;
        c.addEventListener("change", function () { f.content_notes = NOTES.filter(function (x) { return x === n ? c.checked : f.content_notes.indexOf(x) >= 0; }); });
        return h("label", null, [c, h("span", { text: n === "Historical symbols" ? "Historical symbols (for example in WW2 strategy mods)" : n })]);
      })),
      h("p", { class: "muted", style: "font-size:14px", text: "Rating changes are logged and visible to moderators. Sexually explicit content isn't allowed at any rating." }),
      h("h3", { text: "Handoff packet" }),
      h("div", { class: "form-grid" }, [
        field("What works", area("works", 2000, 4), "Required. One point per line.", true),
        field("What's broken", area("broken", 2000, 4), null, true),
        field("What you were going for", area("vision", 2000, 3), null, true),
        field("Agent context file (CLAUDE.md or AGENTS.md)", area("agent_context", 20000, 6), null, true),
        prov
      ]),
      h("div", { class: "actions" }, [saveBtn, h("a", { class: "btn btn-ghost", href: "project.html?id=" + pid, text: "Back to the project page" })])
    ]));
    root.appendChild(h("section", { class: "panel wizard" }, [
      h("h2", { text: "What can't be changed here" }),
      h("ul", null, [
        h("li", { text: "Lineage and credit: they stay as recorded." }),
        h("li", null, ["License records: earlier snapshots are kept. If your repository's license has changed, saving this page adds a new snapshot. ", h("a", { href: "license.html?id=" + pid, text: "See the license record" }), "."]),
        h("li", { text: "The repository, the type and the base game: a different repository means a transfer or a new listing." }),
        h("li", { text: "Screenshots and the browser build are managed on the project page itself." })
      ]),
      p.status === "adopt" ? null : h("p", null, ["Moving on? ", h("a", { href: "list.html?intent=leave&repo=" + encodeURIComponent(repo), text: "Put this project up for adoption" }), ". That goes through the handoff steps, so the license and name questions are asked."])
    ]));
  }

  if (!/^[a-z0-9-]{1,80}$/.test(id) || window.location.protocol === "file:") return message(["No project chosen."]);
  Promise.all([BC.whoAmI(), BC.api("GET", "/api/projects/" + encodeURIComponent(id) + "?t=" + Date.now())]).then(function (r) {
    var user = r[0], res = r[1];
    if (!res.ok) return message([res.status === 404 ? "That project doesn't exist." : BC.errorText("server_error")]);
    p = res.data.project;
    var k = res.data.packet || {};
    document.getElementById("e-title-h").textContent = "Edit " + p.title;
    if (!user) return message([h("a", { href: "/api/auth/login?return_to=" + encodeURIComponent("/edit.html?id=" + id), text: "Sign in with GitHub" }), " to edit this page."]);
    if (user.handle !== p.owner) return message(["Only this project's maintainer, @" + (p.owner || "unknown") + ", can edit its page."]);
    f = {
      title: p.title || "", note: p.note || "", genre: p.genre, tech: p.tech || "", browser: !!p.browser, status: p.status,
      rating: p.rating || "everyone", content_notes: (p.content_notes || []).slice(),
      works: k.works || "", broken: k.broken || "", vision: k.vision || "", agent_context: k.agent_context || "",
      provenance: Array.isArray(k.provenance) ? k.provenance.map(function (x) { return { part: String(x.part || ""), how: String(x.how || "") }; }) : []
    };
    render();
  });
})();
