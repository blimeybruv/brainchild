// Brainchild Worker: the main script of the site Worker (see wrangler.jsonc).
// Requests to /api/* come here first; everything else is a static file from site/.
// Bindings: DB -> D1 "brainchild-db", BUILDS -> R2 "brainchild-builds", ASSETS -> site/
// Secrets (set in the Cloudflare dashboard): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//
// Routes:
//   GET  /api/health, /api/projects, /api/projects/<id>   public, cached for 60s
//   GET  /api/auth/login, /api/auth/callback              GitHub sign-in (auth.js)
//   POST /api/auth/logout
//   GET  /api/me                                          who is signed in
//   GET  /api/repos/<owner>/<repo>/access                 repo ownership check (github.js)

import { json, privateJson, NO_STORE } from "./http.js";
import { login, callback, logout, me, getSession } from "./auth.js";
import { repoAccessRoute } from "./github.js";

const PROJECT_FIELDS =
  "id, title, kind, genre, status, base_game, tech, browser, license, note, tone, featured, repo_url, handed_off_at, updated_at";

function notFound() {
  return json({ error: "not_found" }, 404, NO_STORE);
}

function methodNotAllowed(allow) {
  return json({ error: "method_not_allowed" }, 405, { allow, ...NO_STORE });
}

async function listProjects(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${PROJECT_FIELDS} FROM projects ORDER BY COALESCE(handed_off_at, updated_at) DESC, title`
  ).all();
  return json({ projects: results });
}

async function getProject(env, id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return notFound();
  const project = await env.DB.prepare(`SELECT ${PROJECT_FIELDS} FROM projects WHERE id = ?`).bind(id).first();
  if (!project) return notFound();
  const packet = await env.DB.prepare(
    "SELECT works, broken, vision, agent_context, provenance, updated_at FROM packets WHERE project_id = ?"
  ).bind(id).first();
  const { results: lineage } = await env.DB.prepare(
    `SELECT u.handle, l.role, l.started_at, l.ended_at
       FROM lineage l JOIN users u ON u.id = l.user_id
      WHERE l.project_id = ? ORDER BY l.started_at`
  ).bind(id).all();
  if (packet && packet.provenance) {
    try { packet.provenance = JSON.parse(packet.provenance); } catch { packet.provenance = null; }
  }
  return json({ project, packet: packet || null, lineage });
}

// Routes that depend on who is asking. None of these are ever cached.
async function handlePrivate(request, env, ctx, url, path) {
  const method = request.method;
  if (path === "/api/auth/login") return method === "GET" ? login(request, env, url) : methodNotAllowed("GET");
  if (path === "/api/auth/callback") return method === "GET" ? callback(request, env, url) : methodNotAllowed("GET");
  if (path === "/api/auth/logout") return method === "POST" ? logout(request, env, ctx) : methodNotAllowed("POST");
  if (path === "/api/me") return method === "GET" ? me(request, env, url) : methodNotAllowed("GET");
  const repo = path.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/access$/);
  if (repo) {
    if (method !== "GET") return methodNotAllowed("GET");
    let owner, name;
    try { owner = decodeURIComponent(repo[1]); name = decodeURIComponent(repo[2]); } catch { return notFound(); }
    return repoAccessRoute(env, await getSession(request, env), owner, name);
  }
  return null;
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "");

  if (path.startsWith("/api/auth/") || path === "/api/me" || path.startsWith("/api/repos/")) {
    try {
      return (await handlePrivate(request, env, ctx, url, path)) || notFound();
    } catch (err) {
      console.error("api error", err && err.message);
      return privateJson({ error: "server_error" }, 500);
    }
  }

  // Public, read-only listings.
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");

  // Serve from Cloudflare's edge cache when we can, to save database reads.
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let response;
  try {
    if (path === "/api/health") {
      response = json({ ok: true }, 200, NO_STORE);
    } else if (path === "/api/projects") {
      response = await listProjects(env);
    } else if (path.startsWith("/api/projects/")) {
      let id;
      try { id = decodeURIComponent(path.slice("/api/projects/".length)); } catch { id = ""; }
      response = await getProject(env, id);
    } else {
      response = notFound();
    }
  } catch (err) {
    console.error("api error", err && err.message);
    return json({ error: "server_error" }, 500, NO_STORE);
  }

  if (response.status === 200 && response.headers.get("cache-control") !== "no-store") {
    ctx.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx, url);
    }
    // Anything else is a static file (or the 404 page) from site/.
    return env.ASSETS.fetch(request);
  }
};
