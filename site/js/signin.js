/* Choosing how to sign in. Carries the page to return to, and hides a choice that can't work here. */
(function () {
  var params = new URLSearchParams(window.location.search);
  var back = params.get("return_to") || "/";
  // Only ever a page on this site. The address is parsed the way the browser will read it, because
  // a backslash after the first slash, or a tab between two slashes, leads to another site.
  try {
    var target = new URL(back, window.location.origin);
    back = back.charAt(0) === "/" && target.origin === window.location.origin ? target.pathname + target.search + target.hash : "/";
  } catch (e) { back = "/"; }
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
