/* Report form for people who aren't signed in. All text goes in with textContent. */
(function () {
  var BC = window.BC, h = BC.h, root = document.getElementById("m-body");
  var CATS = [
    ["sexual", "Sexual content", "Not allowed on Brainchild, including in mods."],
    ["rating", "Wrong rating", "It should be rated Teen or Mature, or needs content notes."],
    ["malware", "Malware or suspicious download", "It does something harmful or unexpected."],
    ["license", "License or copyright problem", "Someone else's work, or the license is wrong."],
    ["harass", "Harassment or hate", "Targets a person or group."],
    ["spam", "Spam or junk", "Ads, scams, or no real content."],
    ["other", "Something else", "Tell us in the reasons."]
  ];
  var LABELS = { category: "What's wrong", url: "Address of the page", details: "Your reasons", reply_to: "Reply-to address" };
  var st = { cat: null, url: new URLSearchParams(window.location.search).get("url") || "", details: "", reply: "", token: null, error: "", busy: false, siteKey: null, widget: null };

  function message(parts) { root.textContent = ""; root.appendChild(h("p", { class: "callout plain" }, parts)); }
  function field(label, control, hint) {
    var id = "r-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
    control.id = id;
    return h("div", { class: "field wide" }, [h("label", { for: id, text: label }), control, hint ? h("span", { class: "hint", text: hint }) : null]);
  }

  // Cloudflare's bot check draws itself into #bot-check and hands back a one-time token.
  function drawCheck() {
    var box = document.getElementById("bot-check");
    if (!box || !window.turnstile || !st.siteKey || box.getAttribute("data-drawn")) return;
    box.setAttribute("data-drawn", "1");
    st.widget = window.turnstile.render(box, {
      sitekey: st.siteKey, theme: "dark",
      callback: function (token) { st.token = token; var b = document.getElementById("r-send"); if (b) b.disabled = st.busy; },
      "expired-callback": function () { st.token = null; var b = document.getElementById("r-send"); if (b) b.disabled = true; },
      "error-callback": function () { st.token = null; var b = document.getElementById("r-send"); if (b) b.disabled = true; }
    });
  }
  window.bcTurnstileReady = drawCheck;

  function showError(text) {
    st.error = text;
    var el = document.getElementById("r-error");
    if (el) { el.textContent = text; el.hidden = !text; }
  }

  function send() {
    st.busy = true; showError("");
    document.getElementById("r-send").disabled = true;
    BC.api("POST", "/api/outside-reports", { category: st.cat, url: st.url, details: st.details, reply_to: st.reply, token: st.token }).then(function (res) {
      st.busy = false;
      if (res.ok) {
        return message([h("strong", { text: "Thanks, your report is in. " }), "The site's operator reviews every report. " +
          (st.reply ? "Your reply-to address is kept private and deleted when the case is closed." : "You didn't leave a reply-to address, so we can't tell you the outcome.")]);
      }
      var e = res.data || {};
      showError(e.error === "invalid_fields" && e.fields ? "Please fill in or fix: " + e.fields.map(function (k) { return LABELS[k] || k; }).join(", ") + "."
        : e.error === "bot_check_failed" ? "The bot check didn't pass. Please try it again."
        : e.error === "slow_down" ? "A lot of reports have come in during the last hour. Please try again later."
        : e.error === "report_form_unavailable" ? "The report form isn't available right now." : BC.errorText(e.error));
      // A token works once, so ask for a fresh check.
      st.token = null;
      if (window.turnstile && st.widget !== null) { try { window.turnstile.reset(st.widget); } catch (x) { /* a fresh check appears on reload */ } }
    });
  }

  // Only the list of categories is redrawn when one is picked. The rest of the form, and above
  // all the bot-check box, is built once and left alone: moving that box would break the check.
  function drawCategories() {
    var box = document.getElementById("r-cats");
    box.textContent = "";
    box.appendChild(BC.choices("What's wrong?", CATS.map(function (c) { return { value: c[0], label: c[1], desc: c[2] }; }), st.cat, function (v) { st.cat = v; drawCategories(); }, "stack"));
  }

  function render() {
    var url = h("input", { class: "input", type: "url", maxlength: "300", placeholder: "https://brainchild.nexus/project.html?id=…" });
    url.value = st.url; url.addEventListener("input", function () { st.url = url.value; });
    var details = h("textarea", { class: "textarea", rows: "5", maxlength: "2000", placeholder: "What is the problem, and where on the page is it?" });
    details.value = st.details; details.addEventListener("input", function () { st.details = details.value; });
    var reply = h("input", { class: "input", type: "email", maxlength: "200", autocomplete: "email" });
    reply.value = st.reply; reply.addEventListener("input", function () { st.reply = reply.value; });
    var sendBtn = h("button", { class: "btn btn-primary", type: "button", id: "r-send", text: "Send report", disabled: true });
    sendBtn.addEventListener("click", send);
    var error = h("p", { class: "form-error", role: "alert", id: "r-error" });
    error.hidden = true;
    root.textContent = "";
    root.appendChild(h("section", { class: "panel wizard" }, [
      h("h2", { text: "What's wrong?" }),
      h("div", { id: "r-cats" }),
      h("div", { class: "form-grid" }, [
        field("Address of the page", url, "Copy it from your browser's address bar. It must be a page on brainchild.nexus or a game on brainwave.nexus."),
        field("Your reasons", details, "Required. If you believe something is illegal, say which law or right and why."),
        field("Reply-to address (optional)", reply, "Only the site's operator sees it. It is never shown on the site and is deleted when your report is closed.")
      ]),
      h("div", { id: "bot-check", class: "bot-check" }),
      error,
      h("div", { class: "actions" }, [sendBtn]),
      h("p", { class: "muted", style: "font-size:14px", text: "The check above tells people from bots; it is run by Cloudflare, which also hosts this site. Brainchild doesn't keep your IP address with the report." })
    ]));
    drawCategories();
    drawCheck();
  }

  if (window.location.protocol === "file:") return message(["This page only works on the live site."]);
  BC.api("GET", "/api/report-form").then(function (res) {
    if (!res.ok || !res.data.available) {
      return message(["The report form isn't available here right now. If you have a GitHub account, ", h("a", { href: "/api/auth/login?return_to=%2Fbrowse.html", text: "sign in" }), " and use the Report button on the project's page."]);
    }
    st.siteKey = res.data.site_key;
    render();
  });
})();
