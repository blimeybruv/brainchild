/* Choosing how to sign in. Carries the page to return to, and hides a choice that can't work here. */
(function () {
  var params = new URLSearchParams(window.location.search);
  var back = params.get("return_to") || "/";
  if (back.charAt(0) !== "/" || back.indexOf("//") === 0) back = "/";
  var gh = document.getElementById("signin-github"), gl = document.getElementById("signin-gitlab");
  gh.setAttribute("href", "/api/auth/login?provider=github&return_to=" + encodeURIComponent(back));
  gl.setAttribute("href", "/api/auth/gitlab/login?return_to=" + encodeURIComponent(back));
  if (window.location.protocol === "file:") return;
  fetch("/api/me", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.user) { window.location.replace(back); return; } // already signed in
    var p = j.providers || {};
    if (!p.github) gh.hidden = true;
    if (!p.gitlab) gl.hidden = true;
    if (!p.github && !p.gitlab) document.getElementById("signin-note").textContent = "Sign-in isn't available at this address.";
  }).catch(function () {});
})();
