// Serves hosted browser builds on brainwave.nexus, one sub-address per game:
//   https://<project id>.brainwave.nexus/
//
// Why a separate Worker on a separate domain: a build is someone else's JavaScript. On its own
// origin it can't read Brainchild's session cookie or pages, and each game is also kept apart
// from every other game. This Worker never reads or sets cookies and has no sign-in code.
//
// Bindings: DB -> D1 "brainchild-db" (read only here), BUILDS -> R2 "brainchild-builds".

import { BUILD_HOST, cleanPath, typeFor } from "../api/build-rules.js";

const SITE = "https://brainchild.nexus";

// What a game may do in the browser: run its own files, and nothing that reaches other sites.
// It can't submit forms, open pop-ups, or be embedded anywhere except a Brainchild project page.
const GAME_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "connect-src 'self' data: blob:",
  "form-action 'none'",
  "base-uri 'self'",
  "frame-ancestors " + SITE,
  "sandbox allow-scripts allow-same-origin allow-pointer-lock"
].join("; ");

function page(status, title, text) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;` +
    `align-items:center;justify-content:center;gap:12px;background:#15171B;color:#ECEDEE;font-family:system-ui,sans-serif;text-align:center;padding:24px}` +
    `a{color:#F5B83D}</style></head><body><h1>${title}</h1><p>${text}</p><p><a href="${SITE}/browse.html">Browse projects on Brainchild</a></p></body></html>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "referrer-policy": "no-referrer"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    if (host === BUILD_HOST || host === "www." + BUILD_HOST || !host.endsWith("." + BUILD_HOST)) {
      return page(200, "Brainwave", "This address hosts playable builds of projects listed on Brainchild. Each game runs here, apart from the main site.");
    }
    const projectId = host.slice(0, -(BUILD_HOST.length + 1));
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(projectId)) return page(404, "Not found", "There is no game at this address.");

    let path;
    try { path = decodeURIComponent(url.pathname).replace(/^\/+/, ""); } catch { path = null; }
    if (path === "" || (path && path.endsWith("/"))) path += "index.html";
    path = cleanPath(path);
    const type = path ? typeFor(path) : null;
    if (!path || !type) return page(404, "Not found", "That file isn't part of this game.");

    const wantsRange = request.headers.has("range");
    const cache = caches.default;
    if (!wantsRange) {
      let hit = null;
      try { hit = await cache.match(request); } catch { hit = null; }
      if (hit) return hit;
    }

    // The game must still be listed (not removed by a moderator) and have a live build.
    const row = await env.DB.prepare(
      "SELECT b.id FROM builds b JOIN projects p ON p.id = b.project_id WHERE b.project_id = ? AND b.status = 'active' AND p.hidden_at IS NULL"
    ).bind(projectId).first();
    if (!row) return page(404, "Not found", "There is no game at this address.");

    const key = "builds/" + projectId + "/" + row.id + "/" + path;
    const obj = wantsRange ? await env.BUILDS.get(key, { range: request.headers }) : await env.BUILDS.get(key);
    if (!obj) return page(404, "Not found", "That file isn't part of this game.");

    const headers = new Headers({
      "content-type": type, // decided by the file's extension from a fixed list, never by the uploader
      "x-content-type-options": "nosniff",
      "content-security-policy": GAME_CSP,
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
      "accept-ranges": "bytes",
      "etag": obj.httpEtag,
      // Short, so a replaced or removed build disappears everywhere within five minutes.
      "cache-control": "public, max-age=300"
    });
    if (wantsRange && obj.range && typeof obj.range.offset === "number") {
      const end = obj.range.offset + (obj.range.length || obj.size - obj.range.offset) - 1;
      headers.set("content-range", `bytes ${obj.range.offset}-${end}/${obj.size}`);
      headers.set("content-length", String(end - obj.range.offset + 1));
      return new Response(request.method === "HEAD" ? null : obj.body, { status: 206, headers });
    }
    headers.set("content-length", String(obj.size));
    const response = new Response(request.method === "HEAD" ? null : obj.body, { status: 200, headers });
    if (request.method === "GET" && obj.size <= 5 * 1024 * 1024) ctx.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    return response;
  }
};
