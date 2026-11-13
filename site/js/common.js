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
      repo: r.repo_url || null
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

  window.BC = { h: h, card: card, metaLine: metaLine, store: safeStore(), load: load, getJSON: getJSON, whoAmI: whoAmI };
})();
