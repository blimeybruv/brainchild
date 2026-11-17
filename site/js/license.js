/* Public license record for one project. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h;
  var root = document.getElementById("l-body");
  var id = new URLSearchParams(window.location.search).get("id") || "";
  var wanted = Number(new URLSearchParams(window.location.search).get("v")) || 0;
  var data = null, current = null, texts = {}, checked = {}, masked = {};
  // Where the original file can be read at the recorded commit (to check the fingerprint when an
  // email address had to be hidden in the copy shown here).
  function originalUrl(r) {
    var host = r.repo_host || "github", full = r.repo_full_name, path = r.license_path || "LICENSE";
    if (!full || !/^[0-9a-f]{40}$/.test(r.commit_sha || "")) return null;
    var tail = full + (host === "github" ? "/blob/" : "/-/blob/") + r.commit_sha + "/" + path.split("/").map(encodeURIComponent).join("/");
    if (host === "github") return "https://github.com/" + tail;
    if (host === "gitlab") return "https://gitlab.com/" + tail;
    var sh = String(host).indexOf("selfhosted:") === 0 ? host.slice(11) : "";
    return /^[a-z0-9.-]+$/.test(sh) ? "https://" + sh + "/" + tail : null;
  }

  function copyleft(s) { return /^(GPL|AGPL|LGPL)-/.test(s || ""); }
  function licName(r) {
    if (r.spdx_id) return r.spdx_id + (r.detection === "with_note" ? " (with a note)" : "");
    return r.detection === "conditions" && r.base_spdx ? "Custom license (" + r.base_spdx + " with added conditions)" : "Custom license";
  }
  // How Brainchild knows what the license is, when the host didn't name it.
  function detected(r) {
    if (r.detection === "matched") return " " + hostName(r) + " didn't name this license; Brainchild recognised the standard " + r.spdx_id + " text in the file.";
    if (r.detection === "with_note") return " The file also has wording from the maker about what the license covers, shown below. They confirmed it only explains and adds no conditions.";
    if (r.detection === "conditions") return " The file has the standard " + r.base_spdx + " text plus wording the maker said adds conditions, shown below. Those conditions are part of the license.";
    if (r.detection === "several") return " The file holds more than one license text (" + (r.base_spdx || "") + "); read it to see which parts each covers.";
    return "";
  }
  function hostName(r) { return r.repo_host === "gitlab" || String(r.repo_host || "").indexOf("selfhosted:") === 0 ? "GitLab" : "GitHub"; }
  function short(sha) { return String(sha || "").slice(0, 7); }
  function kicker(r) { return { handoff: "At handoff", listing: "When listed", adoption: "After adoption", relicense: "Relicensed", license_change: "License changed" }[r.kind] || "Version " + r.version; }
  function nameRule(n) { return { keep: "Adopters may keep it", continuation: "Keep it, as a continuation", rename: "Adopters must rename" }[n] || "Stays with the maintainer"; }

  // Non-commercial art, said in plain words wherever the record explains what a version means.
  function meaning(r) {
    var a = r.assets_license;
    var art = a === "CC BY-NC-SA 4.0" ? " The art is CC BY-NC-SA 4.0: it can be changed and shared, but not sold, and changed art stays under the same license."
      : a === "CC BY-NC 4.0" ? " The art is CC BY-NC 4.0: it can be changed and shared, but not sold." : "";
    return meaningCore(r) + art;
  }
  function meaningCore(r) {
    var first = data.records[0], lic = licName(r), c = short(r.commit_sha);
    if (r.version > 1 && r.kind === "license_change") {
      var prev = data.records.filter(function (x) { return x.version === r.version - 1; })[0] || first;
      return "The repository's license file changed. From commit " + c + " the maintainer releases the project under " + lic + ". " +
        "Everything released before that, up to commit " + short(prev.commit_sha) + ", stays under " + licName(prev) + ", and that can't be taken back.";
    }
    if (r.version > 1 && r.kind === "relicense") {
      return "The new maintainer releases their version under " + lic + ". That's allowed because " + licName(first) + " permits it, but only for their version. " +
        "The original code up to commit " + short(first.commit_sha) + " is still " + licName(first) + ", and that can't be taken back.";
    }
    if (!r.spdx_id) return "Everything up to commit " + c + " was released under the license text below, permanently. It isn't a standard license, so read it to see what it allows." + detected(r);
    var base = copyleft(r.spdx_id)
      ? "Everything up to commit " + c + " is " + lic + ", permanently. Anyone can use and change it, but anyone sharing a changed copy must keep it open under the same license. Later versions of this project stay " + lic + " too."
      : "Everything up to commit " + c + " is " + lic + ", permanently. Anyone can use, change or share it, as long as the license notice stays with the code. Later changes to the project can't take that away.";
    if (r.spdx_id === "Apache-2.0") base += " Apache-2.0 grants no rights to the project's name or trademarks; the name rule alongside is what applies.";
    if (r.version > 1) base = "The project changed hands here. " + base;
    base += detected(r);
    if (data.project.kind === "Mod" && data.project.base_game) base += " This is made for " + data.project.base_game + ": the license covers only this project's own files, and the terms of " + data.project.base_game + " still apply.";
    return base;
  }

  function history() {
    var items = [];
    data.records.forEach(function (r) {
      var by = r.recorded_by ? "@" + r.recorded_by + " · " : "";
      if (r.kind === "license_change") {
        items.push({ title: "License changed to " + licName(r), detail: by + "from commit " + short(r.commit_sha) + " · " + BC.niceDate(r.recorded_at) });
      } else if (r.kind === "adoption" || r.kind === "relicense") {
        var l = data.lineage.filter(function (x) { return x.repo_full_name === r.repo_full_name && x.how !== "created"; })[0];
        items.push({ title: "Adopted by @" + (r.recorded_by || "a new maintainer"), detail: (l && l.how === "transferred" ? "Repository transferred to " : "Forked to ") + BC.repoWhere(r.repo_host, "") + r.repo_full_name + " · " + BC.niceDate(r.recorded_at) });
        items.push({ title: r.kind === "relicense" ? "New work relicensed " + licName(r) : "Stays under " + licName(r), detail: by + "from commit " + short(r.commit_sha) });
      } else {
        items.push({ title: "Released under " + licName(r) + (r.kind === "handoff" ? " at handoff" : " when listed"),
          detail: by + "commit " + short(r.commit_sha) + " · " + BC.niceDate(r.recorded_at) + (r.assets_license ? " · assets: " + r.assets_license : "") });
      }
    });
    return h("ol", { class: "lineage" }, items.map(function (e, i) {
      return h("li", null, [
        h("div", { class: "rail" }, [h("span", { class: "node", "aria-hidden": "true" }), i < items.length - 1 ? h("span", { class: "line", "aria-hidden": "true" }) : null]),
        h("div", null, [h("p", { class: "who", text: e.title }), h("p", { class: "when", text: e.detail })])
      ]);
    }));
  }

  function render() {
    var r = current, fp = r.license_sha256, text = texts[fp];
    var check = h("button", { class: "btn btn-ghost", type: "button", text: "Check fingerprint", disabled: typeof text === "string" && !masked[fp] && window.crypto && window.crypto.subtle ? null : true });
    var orig = masked[fp] ? originalUrl(r) : null;
    var maskNote = masked[fp] ? h("p", { class: "muted", style: "font-size:14px" }, [
      "An email address in this file is hidden here, so the fingerprint can't be checked on this page. It's the fingerprint of the original file",
      orig ? [", which you can read ", h("a", { href: orig, rel: "noopener noreferrer", target: "_blank", text: "at this commit in the repository" }), " and check with any SHA-256 tool."] : " in the repository at this commit."
    ].reduce(function (a, x) { return a.concat(x); }, [])) : null;
    check.addEventListener("click", function () {
      window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
        var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
        checked[fp] = hex === fp ? "ok" : "bad";
        render();
      });
    });
    var main = h("div", { class: "main-col" }, [
      BC.choices("Which version", data.records.map(function (v) {
        return { value: v.version, label: kicker(v) + " · " + licName(v), desc: "commit " + short(v.commit_sha) + " · " + (v.recorded_by ? "@" + v.recorded_by + " · " : "") + BC.niceDate(v.recorded_at) };
      }), r.version, function (v) { current = data.records.filter(function (x) { return x.version === v; })[0]; load(); }),
      h("div", { class: "callout plain" }, [h("p", null, [h("strong", { text: "What this means" })]), h("p", { text: meaning(r) })]),
      r.extra_text ? h("div", { class: r.detection === "conditions" ? "callout bad" : "callout plain" }, [h("div", null, [
        h("p", null, [h("strong", { text: r.detection === "conditions" ? "Added conditions (part of the license)" : "Maker's note in the license file (adds no conditions)" })]),
        h("pre", { class: "code-block extra-wording", tabindex: "0", text: r.extra_text })])]) : null,
      h("div", { class: "panel license-file" }, [
        h("div", { class: "rules-head" }, [
          h("span", { text: (r.license_path || "LICENSE") + "  (stored copy, commit " + short(r.commit_sha) + ")" }),
          h("div", { class: "actions" }, [h("a", { class: "btn btn-ghost", href: "/api/license-text/" + fp + "?download=1", text: "Download" }), check])
        ]),
        h("pre", { class: "code-block license-text", tabindex: "0", text: text === undefined ? "Loading the stored copy…" : text === null ? "The stored copy couldn't be loaded. Try again in a minute." : text }),
        h("p", { class: "fingerprint" }, ["Fingerprint (SHA-256): " + fp]),
        maskNote,
        checked[fp] ? h("p", { role: "status", class: checked[fp] === "ok" ? null : "form-error", text: checked[fp] === "ok" ? "✓ Matches the copy stored when this version was released" : "This text does not match the fingerprint." }) : null
      ]),
      r.version === 1 ? h("div", { class: "callout plain" }, [
        h("p", null, [h("strong", { text: "Maker's release statement" })]),
        h("blockquote", { class: "agree", text: "\"I own this project, and I release this version under the licenses above so that others can continue it. I understand this can't be withdrawn for this version.\"" }),
        h("p", { class: "muted", text: "Confirmed by " + (r.recorded_by ? "@" + r.recorded_by : "the maker") + " (verified owner) on " + BC.niceDate(r.recorded_at) + "." })
      ]) : null
    ]);
    var rows = [["Commit", short(r.commit_sha)], ["Taken", BC.niceDate(r.recorded_at)], ["Repository", BC.repoWhere(r.repo_host, r.repo_full_name)],
      ["By", r.recorded_by ? "@" + r.recorded_by + " ✓ verified" : "—"], ["Code", licName(r)], ["Assets", r.assets_license || "—"],
      ["Name", nameRule(r.name_rights)], ["Stored copy", "License text, kept by Brainchild"]];
    // Software Heritage: an independent public archive of the repo, requested when this version was recorded.
    var arch = (data.archive || []).filter(function (a) { return a.version === r.version; })[0];
    var archDd = null;
    if (arch && arch.status === "archived" && typeof arch.url === "string" && arch.url.indexOf("https://archive.softwareheritage.org/") === 0) {
      archDd = h("dd", null, [h("a", { href: arch.url, rel: "noopener noreferrer", target: "_blank", text: "Archived at Software Heritage" })]);
    } else if (arch && arch.status === "requested") {
      archDd = h("dd", { text: "Requested from Software Heritage; not finished yet" });
    } else if (arch && arch.status === "failed") {
      archDd = h("dd", { text: "Software Heritage couldn't archive this repository" });
    }
    var dl = h("dl", { class: "snap" });
    rows.forEach(function (x) { dl.appendChild(h("dt", { text: x[0] })); dl.appendChild(h("dd", { text: x[1] })); });
    if (archDd) { dl.appendChild(h("dt", { text: "Independent archive" })); dl.appendChild(archDd); }
    var side = h("aside", { class: "side-col" }, [
      h("div", { class: "panel" }, [h("h2", { text: "Snapshot" }), dl]),
      h("div", { class: "panel" }, [h("h2", { text: "License history" }), history()]),
      h("div", { class: "panel" }, [h("p", { style: "margin:0" }, [h("a", { href: "project.html?id=" + encodeURIComponent(data.project.id), text: "Back to " + data.project.title })])])
    ]);
    root.textContent = "";
    root.appendChild(main);
    root.appendChild(side);
  }

  function load() {
    var fp = current.license_sha256;
    render();
    if (texts[fp] !== undefined) return;
    fetch("/api/license-text/" + fp).then(function (res) {
      if (!res.ok) return null;
      masked[fp] = res.headers.get("x-brainchild-masked") === "1"; // an email address in it was hidden
      return res.text();
    }, function () { return null; }).then(function (t) { texts[fp] = t; render(); });
  }

  function message(text) { root.textContent = ""; root.appendChild(h("p", { class: "muted", text: text })); }
  if (!/^[a-z0-9-]{1,80}$/.test(id) || window.location.protocol === "file:") return message("No project chosen.");
  BC.api("GET", "/api/projects/" + encodeURIComponent(id) + "/license").then(function (res) {
    if (!res.ok) return message(res.status === 404 ? "That project doesn't exist." : BC.errorText("server_error"));
    data = res.data;
    document.title = "License record: " + data.project.title + " · Brainchild";
    document.getElementById("l-title").textContent = data.project.title;
    if (!data.records.length) return message("No license record has been kept for this project yet. Records start when a maker lists a project through Brainchild.");
    current = data.records.filter(function (x) { return x.version === wanted; })[0] || data.records[data.records.length - 1];
    load();
  });
})();
