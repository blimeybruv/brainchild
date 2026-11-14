/* Project page: playing the hosted build, and (for the maintainer) uploading one. */
(function () {
  var BC = window.BC, h = BC.h;
  if (window.location.protocol === "file:") return;
  var HOST = /^https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.brainwave\.nexus\/$/; // builds only ever run from here
  var TYPES = "html htm js mjs css json map webmanifest txt xml csv wasm png jpg jpeg gif webp avif svg ico mp3 ogg wav m4a mp4 webm woff woff2 ttf otf glb gltf bin data pck unityweb mem dat atlas fnt ktx2".split(" ");
  var PART = /^[A-Za-z0-9_@()+,\- ][A-Za-z0-9._@()+,\- ]{0,119}$/;
  var MAX_FILE = 25 * 1024 * 1024, MAX_BUILD = 100 * 1024 * 1024, MAX_FILES = 400;

  document.addEventListener("bc:project", function (e) {
    var p = e.detail, stage = document.getElementById("p-stage"), box = document.getElementById("p-build");
    var live = typeof p.play_url === "string" && HOST.test(p.play_url) ? p.play_url : null;
    var mine = false, msg = "", busy = false;
    var build = p.build || null;

    // Under the player: which version this is, when it was uploaded, and the repo's commit at the time.
    function versionLine() {
      var el = document.getElementById("p-version");
      if (!el) return;
      el.textContent = "";
      if (!live || !build) return;
      el.appendChild(document.createTextNode("Version " + build.version + " · uploaded " + BC.niceDate(build.uploaded_at) +
        (build.commit ? " · repository was at commit " + String(build.commit).slice(0, 7) : "")));
    }

    function play() {
      var frame = h("iframe", {
        class: "stage-frame", src: live, title: p.title + ", running in the page",
        // The game runs on its own address with no access to this page; it can't open pop-ups or leave the frame.
        sandbox: "allow-scripts allow-same-origin allow-pointer-lock", allow: "fullscreen; gamepad; autoplay", referrerpolicy: "no-referrer"
      });
      stage.textContent = "";
      stage.classList.add("playing");
      stage.appendChild(frame);
      // Bring the whole play area into the window, so the game's lower controls aren't below the fold.
      try { stage.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) { stage.scrollIntoView(true); }
      var full = h("button", { class: "chip", type: "button", text: "Full screen" });
      full.addEventListener("click", function () { if (frame.requestFullscreen) frame.requestFullscreen(); });
      var stop = h("button", { class: "chip", type: "button", text: "Stop" });
      stop.addEventListener("click", function () { window.location.reload(); });
      var bar = document.getElementById("p-playbar");
      bar.textContent = "";
      bar.appendChild(full); bar.appendChild(stop);
      bar.appendChild(h("a", { href: live, target: "_blank", rel: "noopener noreferrer", text: "Open in a new tab" }));
    }
    function wirePlayButton() {
      var old = document.getElementById("p-play");
      if (!live || !old) return;
      var btn = old.cloneNode(true); // drops the earlier "go to the repo" behaviour
      btn.disabled = false; btn.removeAttribute("title");
      btn.querySelector("#p-play-label").textContent = p.kind === "App" ? "Open in browser" : "Play in browser";
      btn.addEventListener("click", play);
      old.replaceWith(btn);
      var hint = document.getElementById("p-hint");
      if (hint) hint.textContent = "[ runs on brainwave.nexus, apart from this site ]";
    }

    function note(t) { msg = t; draw(); }
    function check(files) {
      // Folder pickers give "dist/assets/x.js"; drop the folder's own name.
      var list = Array.prototype.map.call(files, function (f) {
        var rel = f.webkitRelativePath || f.name, cut = rel.indexOf("/");
        return { file: f, path: cut >= 0 ? rel.slice(cut + 1) : rel };
      }).filter(function (x) { return x.path && x.path.split("/").every(function (s) { return s[0] !== "."; }); }); // hidden files are skipped
      if (!list.length) return "That folder is empty.";
      if (!list.some(function (x) { return x.path === "index.html"; })) return "That folder has no index.html at its top level. Choose the folder your build tool wrote, for example dist.";
      if (list.length > MAX_FILES) return "That build has " + list.length + " files; the limit is " + MAX_FILES + ".";
      var total = 0;
      for (var i = 0; i < list.length; i++) {
        var x = list[i], ext = x.path.slice(x.path.lastIndexOf(".") + 1).toLowerCase();
        if (x.path.length > 300 || !x.path.split("/").every(function (s) { return PART.test(s) && !/[. ]$/.test(s); })) return "This file name can't be hosted: " + x.path;
        if (x.path.lastIndexOf(".") < 0 || TYPES.indexOf(ext) < 0) return "This kind of file can't be hosted: " + x.path;
        if (x.file.size > MAX_FILE) return "This file is over 25 MB: " + x.path;
        total += x.file.size;
      }
      if (total > MAX_BUILD) return "That build is over 100 MB in total.";
      return list;
    }
    function upload(files) {
      var list = check(files);
      if (typeof list === "string") return note(list);
      busy = true; note("Starting…");
      var base = "/api/projects/" + encodeURIComponent(p.id) + "/builds";
      BC.api("POST", base, {}).then(function (res) {
        if (!res.ok) throw res.data.error;
        var id = res.data.build, done = 0, next = 0, failed = null;
        function worker() {
          if (failed || next >= list.length) return Promise.resolve();
          var x = list[next++];
          return fetch(base + "/" + id + "/files?path=" + encodeURIComponent(x.path), { method: "PUT", credentials: "same-origin", body: x.file })
            .then(function (r) { if (!r.ok) return r.json().then(function (j) { failed = j.error || "upload_failed"; }, function () { failed = "upload_failed"; }); done++; note("Uploading: " + done + " of " + list.length + " files"); })
            .then(worker, function () { failed = "upload_failed"; });
        }
        return Promise.all([worker(), worker(), worker()]).then(function () {
          if (failed) throw failed;
          note("Making it live…");
          return BC.api("POST", base + "/" + id + "/activate", {});
        });
      }).then(function (res) {
        if (!res.ok) throw res.data.error;
        window.location.reload();
      }).catch(function (code) {
        busy = false;
        note({ file_type_not_allowed: "One of the files is a kind that can't be hosted.", no_index_html: "The build has no index.html at its top level.",
          build_too_large: "That build is over 100 MB in total.", too_many_files: "That build has too many files.", storage_full: "Brainchild's build storage is full. Tell the site owner.",
          listing_not_verified: "List this project again through List a project first, so its repository is verified.",
          project_id_too_long: "This project's address is too long to host a build." }[code] || BC.errorText(typeof code === "string" ? code : "server_error"));
      });
    }
    function draw() {
      if (!box) return;
      box.textContent = "";
      if (!mine) return;
      var input = h("input", { type: "file", class: "visually-hidden", id: "build-folder", webkitdirectory: true, multiple: true });
      input.addEventListener("change", function () { if (input.files.length) upload(input.files); });
      box.appendChild(h("label", { class: "btn btn-ghost", for: "build-folder", "aria-disabled": busy ? "true" : null, text: live ? "Upload a new version" : "Upload a browser build" }));
      if (!busy) box.appendChild(input);
      if (live && !busy && build && build.previous) {
        var back = h("button", { class: "chip", type: "button", text: "Roll back to version " + build.previous.version + " (" + BC.niceDate(build.previous.uploaded_at) + ")" });
        back.addEventListener("click", function () {
          back.disabled = true;
          BC.api("POST", "/api/projects/" + encodeURIComponent(p.id) + "/builds/rollback", {}).then(function (res) { if (res.ok) window.location.reload(); else note(BC.errorText(res.data.error)); });
        });
        box.appendChild(back);
      }
      if (live && !busy) {
        var rm = h("button", { class: "chip", type: "button", text: "Remove the hosted build" });
        rm.addEventListener("click", function () {
          if (!window.confirm("Take the hosted build down? People will be sent to the repository instead.")) return;
          BC.api("POST", "/api/projects/" + encodeURIComponent(p.id) + "/builds/remove", {}).then(function (res) { if (res.ok) window.location.reload(); else note(BC.errorText(res.data.error)); });
        });
        box.appendChild(rm);
      }
      box.appendChild(h("p", { class: "muted", role: "status", text: msg || (live
        ? "A new version replaces the live one at once. The version before it is kept, so you can roll back."
        : "Choose the folder your build tool wrote (for example dist). It needs an index.html at its top level; up to 400 files and 100 MB.") }));
    }

    wirePlayButton();
    versionLine();
    BC.whoAmI().then(function (u) { mine = !!u && u.handle === p.owner && p.owner_verified; draw(); });
  });
})();
