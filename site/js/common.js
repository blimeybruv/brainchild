/* Shared helpers. Builds DOM with textContent only, so listing text can never inject HTML. */
(function () {
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function metaLine(item) {
    if (item.kind === "Mod") return "Made for " + item.game + " · needs " + item.game;
    var where = item.browser ? (item.kind === "App" ? "runs in browser" : "plays in browser") : "download";
    return item.genre + " · " + (item.tech || "") + " · " + where;
  }

  function primaryLabel(item) {
    if (item.kind === "Mod") return "Get it";
    if (item.kind === "App") return "Open app";
    return "Play";
  }

  // Card used on the landing page (wide) and browse page (compact).
  function card(item, opts) {
    var S = window.BC_DATA.statuses;
    var compact = opts && opts.compact;
    var href = "project.html?id=" + encodeURIComponent(item.id);
    var actions = compact
      ? h("div", { class: "card-actions single" }, [
          h("a", { class: "btn btn-ghost", href: href, text: item.kind === "Mod" ? "View" : item.kind === "App" ? "View and open" : "View and play" })
        ])
      : h("div", { class: "card-actions" }, [
          h("a", { class: "btn btn-ghost", href: href, text: primaryLabel(item) }),
          h("a", { class: "btn btn-light", href: href, text: S[item.status].cta })
        ]);
    return h("article", { class: "card" }, [
      h("div", { class: "shot", style: "background:" + item.tone, "aria-hidden": "true" }, [
        item.shot ? h("img", { class: "shot-img", src: "/api/screenshots/" + item.shot, alt: "", loading: "lazy" }) : h("span", { text: "[ screenshot ]" }),
        compact ? h("span", { class: "kind", text: kindLabel(item.kind) }) : null
      ]),
      h("div", { class: "card-body" }, [
        h("div", { class: "card-title-row" }, [
          h("h3", { text: item.title }),
          h("span", { class: "badge", "data-status": item.status, text: S[item.status].label })
        ]),
        h("p", { class: "meta", text: metaLine(item) }),
        compact ? null : h("p", { class: "note", text: item.note }),
        h("div", { class: "tags" }, [
          compact ? h("span", { class: "tag", text: item.genre }) : null,
          h("span", { class: "tag", text: item.license }),
          compact ? null : h("span", { class: "tag", text: "handoff packet" })
        ]),
        actions
      ])
    ]);
  }

  function safeStore() {
    try {
      var k = "__bc_test";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  // Database row -> the shape the pages use
  function fromRow(r) {
    return {
      id: r.id, title: r.title, kind: r.kind, genre: r.genre, status: r.status,
      game: r.base_game || undefined, tech: r.tech || undefined, browser: !!r.browser,
      license: r.license, note: r.note || "", tone: r.tone || "#4A4A52", featured: !!r.featured,
      repo: r.repo_url || null,
      owner: r.owner || null, ownerVerified: !!r.owner_verified, rating: r.rating || "everyone",
      notes: Array.isArray(r.content_notes) ? r.content_notes : [], handedOffAt: r.handed_off_at || null,
      openToTransfer: !!r.open_to_transfer, nameRights: r.name_rights || null, shot: r.shot || null, playUrl: r.play_url || null
    };
  }

  function getJSON(url, ms) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 4000) : null;
    return fetch(url, { headers: { accept: "application/json" }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // Load live listings from the API, then run the page. Falls back to js/data.js
  // (for example when the file is opened locally, or the API is down).
  function load(run) {
    var done = false;
    function go() { if (!done) { done = true; run(); } }
    if (window.location.protocol === "file:") return go();
    getJSON("/api/projects")
      .then(function (j) {
        if (j && Array.isArray(j.projects) && j.projects.length) {
          window.BC_DATA.items = j.projects.map(fromRow);
          window.BC_DATA.live = true;
        }
      })
      .catch(function () { /* keep sample data */ })
      .then(go, go);
  }

  // ---------- Talking to the API ----------
  var ERRORS = {
    not_signed_in: "Please sign in first.",
    github_sign_in_again: "Brainchild needs a fresh link to your GitHub account. Connect GitHub from your account page, then retry.",
    gitlab_sign_in_again: "Brainchild needs a fresh link to your GitLab account. Connect GitLab from your account page, then retry.",
    gitlab_error: "GitLab didn't answer properly. Try again in a minute.",
    codeberg_not_supported: "Codeberg isn't supported. Brainchild lists projects on GitHub and GitLab.com.",
    gitlab_com_only: "Only projects on GitLab.com can be listed for now, not self-hosted GitLab.",
    wrong_host: "Your copy has to be on the same site as the project.",
    selfhosted_address: "Enter the project's full address on your GitLab, starting with https://, for example https://git.example.org/your-group/your-project.",
    selfhosted_unreachable: "Brainchild couldn't read that project from your GitLab. It has to be public, and the instance reachable from the internet.",
    not_selfhosted: "That address is on GitHub or GitLab.com. Choose that site instead; it uses sign-in rather than a code.",
    verify_file_missing: "Brainchild couldn't find your code in brainchild-verify.txt at the top of the default branch. Commit the file, then check again.",
    verify_code_not_yours: "The code in brainchild-verify.txt wasn't issued to you for this project. Get a new code and commit that.",
    verify_code_stale: "The code in brainchild-verify.txt has already been used or is more than a week old. Get a new code and commit that.",
    relay_github_only: "Projects on a self-hosted GitLab can't enter Relay rounds, because Brainchild can't check who opened a merge request there.",
    forbidden: "That request wasn't allowed. Reload the page and try again.",
    repo_not_found: "GitHub can't find that repository. Check the address; private repositories can't be listed.",
    repo_not_public: "That repository is private. Only public repositories can be listed.",
    not_repo_admin: "You don't manage that repository: GitHub needs admin rights, GitLab the Maintainer or Owner role.",
    bad_repo_name: "That doesn't look like a repository address. Use the form owner/name.",
    no_license: "That repository has no license file. Without one nobody may legally continue the project. Add a LICENSE file on GitHub, then try again.",
    no_commits: "That repository has no commits yet.",
    license_too_large: "The license file is too large to store.",
    already_listed: "That repository is already listed on Brainchild.",
    too_many_listings: "You've reached the limit of listings for one account.",
    not_up_for_adoption: "This project isn't up for adoption (someone may have just adopted it).",
    already_yours: "You're already this project's maintainer.",
    transfer_not_offered: "The maker didn't offer a transfer. Fork it instead.",
    not_a_fork_of_original: "GitHub doesn't show that repository as a fork of this project.",
    not_the_transferred_repo: "That isn't this project's repository. Enter its new address after the transfer.",
    original_repo_unknown: "Brainchild can't find this project's original repository on GitHub.",
    license_must_stay: "This project was released under a GPL-family license, so your copy has to stay under the same license. Restore the original LICENSE file in your repository, then try again.",
    must_rename: "The maker asked adopters to pick a new name. Enter a different name.",
    must_keep_original_name: "The maker asked adopters to keep the original name, with a subtitle of your own if you like.",
    github_error: "GitHub didn't answer properly. Try again in a minute.",
    server_error: "Something went wrong on our side. Try again in a minute."
  };
  function errorText(code) { return ERRORS[code] || "That didn't work. Try again in a minute."; }

  // Resolves to { ok, status, data }. Never rejects.
  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin", headers: { accept: "application/json" } };
    if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }, function () { return { ok: false, status: r.status, data: { error: "server_error" } }; });
    }, function () { return { ok: false, status: 0, data: { error: "server_error" } }; });
  }

  function niceDate(s) {
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var d = String(s || "").slice(0, 10).split("-");
    return d.length === 3 && m[Number(d[1]) - 1] ? Number(d[2]) + " " + m[Number(d[1]) - 1] + " " + d[0] : "";
  }

  // The step rail used by the listing and adoption pages.
  function renderSteps(el, labels, current) {
    el.textContent = "";
    labels.forEach(function (label, i) {
      var n = i + 1, state = n < current ? "done" : n === current ? "current" : "todo";
      el.appendChild(h("li", { "data-state": state, "aria-current": state === "current" ? "step" : null }, [
        h("span", { class: "num", text: (state === "done" ? "✓ " : "") + "Step " + n }),
        h("span", { class: "label", text: label })
      ]));
    });
  }

  // A set of radio-style buttons. options: [{ value, label, desc, disabled, extra }]
  function choices(name, options, selected, onPick, cls) {
    return h("div", { class: "choices" + (cls ? " " + cls : ""), role: "radiogroup", "aria-label": name }, options.map(function (o) {
      var b = h("button", { type: "button", class: "choice" + (o.extra ? " row" : ""), role: "radio",
        "aria-checked": o.value === selected ? "true" : "false", "aria-disabled": o.disabled ? "true" : null }, [
        h("span", { class: "c-grow" }, [h("span", { class: "c-label" + (o.mono ? " mono" : ""), text: o.label }), o.desc ? h("span", { class: "c-desc", text: o.desc }) : null].map(function (x) {
          return x ? h("span", { style: "display:block" }, [x]) : null;
        })),
        o.extra || null
      ]);
      b.addEventListener("click", function () { if (!o.disabled) onPick(o.value); });
      return b;
    }));
  }

  // The "handoff rules" block with a Copy button.
  function rulesBlock(title, rules, hint) {
    var copy = h("button", { class: "btn btn-ghost", type: "button", text: "Copy" });
    copy.addEventListener("click", function () {
      try { if (navigator.clipboard) navigator.clipboard.writeText(rules); } catch (e) { /* select by hand instead */ }
      copy.textContent = "Copied";
      setTimeout(function () { copy.textContent = "Copy"; }, 1800);
    });
    return h("div", { class: "callout plain" }, [
      h("div", { class: "rules-head" }, [h("span", { text: title }), copy]),
      h("pre", { class: "code-block", text: rules, tabindex: "0" }),
      h("p", { class: "muted", style: "font-size:14px", text: hint })
    ]);
  }

  // A blog post's text, turned into page elements (never HTML). The subset: paragraphs separated by a
  // blank line, "# " and "## " headings, "- " list items, `code`, and [links](https://...) to http(s) only.
  function inline(text) {
    var out = [], re = /`([^`\n]{1,300})`|\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
      out.push(m[1] !== undefined ? h("code", { text: m[1] }) : h("a", { href: m[3], rel: "nofollow noopener noreferrer", target: "_blank", text: m[2] }));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
    return out;
  }
  function renderPost(text) {
    var box = h("div", { class: "post-body" });
    String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).forEach(function (block) {
      var b = block.trim();
      if (!b) return;
      var lines = b.split("\n");
      if (/^## /.test(b) && lines.length === 1) box.appendChild(h("h3", null, inline(b.slice(3))));
      else if (/^# /.test(b) && lines.length === 1) box.appendChild(h("h2", null, inline(b.slice(2))));
      else if (lines.every(function (l) { return /^\s*[-*] /.test(l); })) box.appendChild(h("ul", null, lines.map(function (l) { return h("li", null, inline(l.replace(/^\s*[-*] /, ""))); })));
      else box.appendChild(h("p", null, inline(lines.join(" "))));
    });
    return box;
  }

  // Mature projects: hidden in lists unless the visitor chooses to see them, and behind a click-through
  // notice on their own page. The choice lasts for the browser session. No country detection, no ID checks.
  var MATURE_KEY = "bc_show_mature";
  function matureOk() { try { return window.sessionStorage.getItem(MATURE_KEY) === "1"; } catch (e) { return false; } }
  function setMatureOk(on) { try { if (on) window.sessionStorage.setItem(MATURE_KEY, "1"); else window.sessionStorage.removeItem(MATURE_KEY); } catch (e) { /* private mode: just this page */ } }
  var RATINGS = {
    everyone: "No violence beyond cartoon or slapstick, no blood, no swearing.",
    teen: "Combat and non-graphic violence, mild blood, horror themes and jump scares, moderate language, drug or alcohol references, war strategy.",
    mature: "Realistic or graphic violence and gore, strong language throughout, drug use shown, disturbing themes."
  };

  // The stored type "Mod" covers mods and plugins for any software (owner's decision, 14 Nov).
  function kindLabel(kind) { return kind === "Mod" ? "Mod / plugin" : kind; }

  // Where a repository lives, for display: github.com/owner/name, gitlab.com/group/name or git.example.org/group/name.
  function repoWhere(host, fullName) {
    var h = typeof host === "string" && host.indexOf("selfhosted:") === 0 ? host.slice(11) : host === "gitlab" ? "gitlab.com" : "github.com";
    return h + "/" + (fullName || "");
  }

  // ---------- Sign-in ----------
  var SIGNIN_NOTICES = {
    unavailable: "Sign-in isn't available here right now.",
    denied: "Sign-in was cancelled. Nothing was shared with Brainchild.",
    failed: "Sign-in didn't work. Please try again.",
    linked: "Linked. You can now sign in with either account.",
    connected: "Connected. You can work on projects from that account now.",
    already_linked: "Your account already has a sign-in from that site. Unlink it on your account page first if you want to use a different one.",
    link_conflict: "That sign-in already belongs to another Brainchild account that has been used, so they can't be joined automatically. Ask a moderator through the contact page to merge them."
  };

  // After a failed sign-in the server sends people back with ?signin=<code>. Show it once.
  function showSignInNotice() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var code = params.get("signin");
    if (!code) return;
    params.delete("signin");
    var rest = params.toString();
    try {
      window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
    } catch (e) { /* the address just keeps the code */ }
    var text = SIGNIN_NOTICES[code];
    var header = document.querySelector(".site-header");
    if (!text || !header) return;
    header.insertAdjacentElement("afterend", h("div", { class: "notice", role: "status" }, [h("p", { class: "wrap", text: text })]));
  }

  function signOut(button) {
    button.disabled = true;
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
      .then(function () { window.location.reload(); }, function () { button.disabled = false; });
  }

  // Swap the "Sign in" link for the signed-in user's avatar and handle.
  function showAccount(link, user) {
    var gh = typeof user.avatar_url === "string" && user.avatar_url.indexOf("https://avatars.githubusercontent.com/") === 0;
    var gl = typeof user.avatar_url === "string" && user.avatar_url.indexOf("https://gitlab.com/uploads/") === 0;
    var avatar = gh || gl
      ? h("img", { class: "avatar", src: user.avatar_url + (gh ? "&s=64" : ""), alt: "", width: "28", height: "28", referrerpolicy: "no-referrer" })
      : null;
    var out = h("button", { class: "btn btn-plain", type: "button", text: "Sign out" });
    out.addEventListener("click", function () { signOut(out); });
    link.replaceWith(h("span", { class: "account" }, [
      user.moderator ? h("a", { class: "account-link", href: "mod.html", text: "Moderation" }) : null,
      avatar, h("a", { class: "account-name", href: "account.html", title: "Your account", text: "@" + user.handle }), out]));
  }

  var mePromise = null;
  // Resolves to { handle, avatar_url } or null. Asked once per page.
  function whoAmI() {
    if (!mePromise) {
      mePromise = window.location.protocol === "file:"
        ? Promise.resolve(null)
        : getJSON("/api/me").then(function (j) { return (j && j.user && typeof j.user.handle === "string") ? j.user : null; })
            .catch(function () { return null; });
    }
    return mePromise;
  }

  function initAuth() {
    showSignInNotice();
    var link = document.querySelector('[data-auth="signin"]');
    if (!link) return;
    var here = window.location.pathname + window.location.search + window.location.hash;
    link.setAttribute("href", "/api/auth/login?return_to=" + encodeURIComponent(here));
    whoAmI().then(function (user) { if (user) showAccount(link, user); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAuth);
  else initAuth();

  window.BC = { h: h, card: card, metaLine: metaLine, store: safeStore(), load: load, getJSON: getJSON, whoAmI: whoAmI, fromRow: fromRow,
    api: api, errorText: errorText, repoWhere: repoWhere, kindLabel: kindLabel, renderPost: renderPost,
    matureOk: matureOk, setMatureOk: setMatureOk, RATINGS: RATINGS, niceDate: niceDate, renderSteps: renderSteps, choices: choices, rulesBlock: rulesBlock };
})();
