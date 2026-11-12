window.BC.load(function () {
  var D = window.BC_DATA;
  var h = window.BC.h;
  var items = D.items;

  var state = { types: [], genres: [], statuses: [], game: null, q: "", sort: "recent" };

  // Pre-select from the URL, e.g. browse.html?type=Mod&game=Luanti
  var params = new URLSearchParams(window.location.search);
  if (params.get("type")) state.types = [params.get("type")];
  if (params.get("game")) state.game = params.get("game");

  var el = {
    type: document.getElementById("f-type"),
    genre: document.getElementById("f-genre"),
    status: document.getElementById("f-status"),
    game: document.getElementById("f-game"),
    count: document.getElementById("result-count"),
    chips: document.getElementById("chips"),
    results: document.getElementById("results"),
    q: document.getElementById("q"),
    sort: document.getElementById("sort")
  };

  function inType(i) { return !state.types.length || state.types.indexOf(i.kind) >= 0; }
  function inGenre(i) { return !state.genres.length || state.genres.indexOf(i.genre) >= 0; }
  function inStatus(i) { return !state.statuses.length || state.statuses.indexOf(i.status) >= 0; }
  function inGame(i) { return !state.game || i.game === state.game; }
  function inQuery(i) {
    if (!state.q) return true;
    var hay = [i.title, i.genre, i.tech, i.game, i.kind, i.note].join(" ").toLowerCase();
    return hay.indexOf(state.q) >= 0;
  }
  function except(skip) {
    return function (i) {
      return (skip === "type" || inType(i)) && (skip === "genre" || inGenre(i)) &&
        (skip === "status" || inStatus(i)) && inGame(i) && inQuery(i);
    };
  }

  function toggle(key, val) {
    var arr = state[key];
    var at = arr.indexOf(val);
    if (at >= 0) arr.splice(at, 1); else arr.push(val);
    render();
  }

  function checkboxList(container, key, values, labelFn, countFn, dotFn) {
    container.textContent = "";
    values.forEach(function (v) {
      var id = "f-" + key + "-" + String(v).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      var input = h("input", { type: "checkbox", id: id });
      input.checked = state[key].indexOf(v) >= 0;
      input.addEventListener("change", function () { toggle(key, v); });
      container.appendChild(h("label", { class: "check-row", for: id }, [
        input,
        dotFn ? h("span", { class: "dot", "data-status": v, "aria-hidden": "true" }) : null,
        h("span", { class: "grow", text: labelFn(v) }),
        h("span", { class: "count", text: String(countFn(v)) })
      ]));
    });
  }

  function render() {
    // Re-rendering replaces the controls, so remember which one had focus
    var focusId = document.activeElement && document.activeElement.id;
    renderAll();
    if (focusId && focusId !== "q") {
      var f = document.getElementById(focusId);
      if (f) f.focus();
    }
  }

  function renderAll() {
    // Filters with live counts (each count respects the other active filters)
    checkboxList(el.type, "types", ["Game", "Mod", "App"],
      function (v) { return v + "s"; },
      function (v) { return items.filter(function (i) { return i.kind === v && except("type")(i); }).length; });
    checkboxList(el.genre, "genres", D.genres,
      function (v) { return v; },
      function (v) { return items.filter(function (i) { return i.genre === v && except("genre")(i); }).length; });
    checkboxList(el.status, "statuses", D.statusOrder,
      function (v) { return D.statuses[v].label; },
      function (v) { return items.filter(function (i) { return i.status === v && except("status")(i); }).length; },
      true);

    // Mods by game: built from the base games mods were submitted for
    var games = [];
    items.forEach(function (i) { if (i.game && games.indexOf(i.game) < 0) games.push(i.game); });
    games.sort();
    el.game.textContent = "";
    var allBtn = h("button", { type: "button", id: "g-all", class: "game-btn", "aria-pressed": state.game ? "false" : "true" },
      [h("span", { class: "grow", text: "All games and mods" })]);
    allBtn.addEventListener("click", function () { state.game = null; render(); });
    el.game.appendChild(allBtn);
    games.forEach(function (g) {
      var n = items.filter(function (i) { return i.game === g; }).length;
      var b = h("button", { type: "button", id: "g-" + g.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), class: "game-btn", "aria-pressed": state.game === g ? "true" : "false" }, [
        h("span", { class: "grow", text: g }),
        h("span", { class: "count", text: n + (n === 1 ? " mod" : " mods") })
      ]);
      b.addEventListener("click", function () { state.game = state.game === g ? null : g; render(); });
      el.game.appendChild(b);
    });

    // Results
    var list = items.filter(except(null));
    if (state.sort === "az") list = list.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
    el.count.textContent = list.length === 1 ? "1 result" : list.length + " results";

    // Chips
    el.chips.textContent = "";
    var chips = [];
    state.types.forEach(function (v) { chips.push([v + "s", function () { toggle("types", v); }]); });
    if (state.game) chips.push(["Mods for " + state.game, function () { state.game = null; render(); }]);
    state.genres.forEach(function (v) { chips.push([v, function () { toggle("genres", v); }]); });
    state.statuses.forEach(function (v) { chips.push([D.statuses[v].label, function () { toggle("statuses", v); }]); });
    if (state.q) chips.push(['"' + state.q + '"', function () { state.q = ""; el.q.value = ""; render(); }]);
    chips.forEach(function (c) {
      var b = h("button", { type: "button", class: "chip", "aria-label": "Remove filter " + c[0] }, [c[0], " ×"]);
      b.addEventListener("click", c[1]);
      el.chips.appendChild(b);
    });
    if (chips.length) {
      var clear = h("button", { type: "button", class: "link-btn", text: "Clear all" });
      clear.addEventListener("click", clearAll);
      el.chips.appendChild(clear);
    }

    el.results.textContent = "";
    if (list.length) {
      el.results.className = "card-grid compact";
      list.forEach(function (i) { el.results.appendChild(window.BC.card(i, { compact: true })); });
    } else {
      el.results.className = "";
      var btn = h("button", { type: "button", class: "btn btn-primary", text: "Clear filters" });
      btn.addEventListener("click", clearAll);
      el.results.appendChild(h("div", { class: "empty" }, [
        h("h2", { text: "Nothing matches those filters." }),
        h("p", { text: "Try fewer genres, or a different game." }),
        btn
      ]));
    }
  }

  function clearAll() {
    state.types = []; state.genres = []; state.statuses = []; state.game = null; state.q = "";
    el.q.value = "";
    render();
  }

  var qTimer;
  el.q.addEventListener("input", function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = el.q.value.trim().toLowerCase(); render(); }, 150);
  });
  el.sort.addEventListener("change", function () { state.sort = el.sort.value; render(); });

  render();
});
