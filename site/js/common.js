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
    if (item.kind === "Mod") return "Mod for " + item.game + " · needs the base game";
    var where = item.browser ? (item.kind === "App" ? "runs in browser" : "plays in browser") : "download";
    return item.genre + " · " + (item.tech || "") + " · " + where;
  }

  function primaryLabel(item) {
    if (item.kind === "Mod") return "Get mod";
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
          h("a", { class: "btn btn-ghost", href: href, text: item.kind === "Mod" ? "View mod" : item.kind === "App" ? "View and open" : "View and play" })
        ])
      : h("div", { class: "card-actions" }, [
          h("a", { class: "btn btn-ghost", href: href, text: primaryLabel(item) }),
          h("a", { class: "btn btn-light", href: href, text: S[item.status].cta })
        ]);
    return h("article", { class: "card" }, [
      h("div", { class: "shot", style: "background:" + item.tone, "aria-hidden": "true" }, [
        h("span", { text: "[ screenshot ]" }),
        compact ? h("span", { class: "kind", text: item.kind }) : null
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
      openToTransfer: !!r.open_to_transfer, nameRights: r.name_rights || null
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
    github_sign_in_again: "Your GitHub link has expired. Sign out, sign in again, then retry.",
    forbidden: "That request wasn't allowed. Reload the page and try again.",
    repo_not_found: "GitHub can't find that repository. Check the address; private repositories can't be listed.",
    repo_not_public: "That repository is private. Only public repositories can be listed.",
    not_repo_admin: "GitHub says you don't have admin rights on that repository.",
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

  // ---------- Sign-in ----------
  var SIGNIN_NOTICES = {
    unavailable: "Sign-in isn't available here right now.",
    denied: "Sign-in was cancelled. Nothing was shared with Brainchild.",
    failed: "Sign-in didn't work. Please try again."
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
    var avatar = typeof user.avatar_url === "string" && user.avatar_url.indexOf("https://avatars.githubusercontent.com/") === 0
      ? h("img", { class: "avatar", src: user.avatar_url + "&s=64", alt: "", width: "28", height: "28", referrerpolicy: "no-referrer" })
      : null;
    var out = h("button", { class: "btn btn-plain", type: "button", text: "Sign out" });
    out.addEventListener("click", function () { signOut(out); });
    link.replaceWith(h("span", { class: "account" }, [avatar, h("span", { class: "account-name", text: "@" + user.handle }), out]));
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
    api: api, errorText: errorText, niceDate: niceDate, renderSteps: renderSteps, choices: choices, rulesBlock: rulesBlock };
})();
