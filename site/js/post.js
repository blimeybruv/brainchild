/* One blog post. The body is turned into page elements by BC.renderPost; nothing is inserted as HTML. */
(function () {
  var BC = window.BC, h = BC.h, box = document.getElementById("post");
  function message(parts) { box.textContent = ""; box.appendChild(h("p", { class: "muted" }, parts)); }
  if (window.location.protocol === "file:") return message(["This page only works on the live site."]);
  var slug = new URLSearchParams(window.location.search).get("slug") || "";
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return message(["No post chosen. ", h("a", { href: "blog.html", text: "See the blog" }), "."]);
  BC.getJSON("/api/posts/" + slug).then(function (j) {
    if (!j || !j.post) return message(["That post isn't there any more. ", h("a", { href: "blog.html", text: "See the blog" }), "."]);
    var p = j.post;
    document.title = p.title + " · Brainchild";
    box.textContent = "";
    box.appendChild(h("p", { class: "eyebrow" }, [h("a", { href: "blog.html", text: "Blog" }), " · " + p.topic]));
    box.appendChild(h("h1", { text: p.title }));
    box.appendChild(h("p", { class: "muted" }, ["By ", p.author ? h("a", { href: "user.html?u=" + encodeURIComponent(p.author), text: "@" + p.author }) : "Brainchild", " · " + BC.niceDate(p.published_at)]));
    box.appendChild(h("p", { class: "sub", text: p.excerpt }));
    box.appendChild(BC.renderPost(p.body));
  }, function () { message(["That post couldn't be loaded. ", h("a", { href: "blog.html", text: "See the blog" }), "."]); });
})();
