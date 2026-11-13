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
//   GET  /api/my/repos                                    the signed-in user's public repos (listings.js)
//   GET  /api/repos/<owner>/<repo>/listing-info           ownership, license and agent file for the listing form
//   POST /api/projects                                    publish a listing (dry_run: true only previews it)
//   POST /api/projects/<id>/adopt                         take a project on
//   GET  /api/projects/<id>/license                       public license record, cached for 60s
//   GET  /api/license-text/<fingerprint>                  the stored copy of a license file

import { json, privateJson, NO_STORE } from "./http.js";
import { login, callback, logout, me, getSession } from "./auth.js";
import { repoAccessRoute } from "./github.js";
import { myRepos, listingInfo, createListing, adoptProject, licenseRecord, licenseText } from "./listings.js";

const PROJECT_FIELDS =
  "p.id, p.title, p.kind, p.genre, p.status, p.base_game, p.tech, p.browser, p.license, p.note, p.tone, p.featured, p.repo_url, " +
  "p.handed_off_at, p.updated_at, p.created_at, p.intent, p.rating, p.content_notes, p.assets_license, p.name_rights, p.open_to_transfer, " +
  "u.handle AS owner, (u.github_id IS NOT NULL AND p.repo_id IS NOT NULL) AS owner_verified";
const PROJECT_FROM = "FROM projects p LEFT JOIN users u ON u.id = p.owner_id";

function shape(row) {
  try { row.content_notes = JSON.parse(row.content_notes || "[]"); } catch { row.content_notes = []; }
  return row;
}

function notFound() {
  return json({ error: "not_found" }, 404, NO_STORE);
}

function methodNotAllowed(allow) {
  return json({ error: "method_not_allowed" }, 405, { allow, ...NO_STORE });
}

async function listProjects(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${PROJECT_FIELDS} ${PROJECT_FROM} ORDER BY COALESCE(p.handed_off_at, p.updated_at) DESC, p.title`
  ).all();
  return json({ projects: results.map(shape) });
}

async function getProject(env, id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return notFound();
  const project = await env.DB.prepare(`SELECT ${PROJECT_FIELDS} ${PROJECT_FROM} WHERE p.id = ?`).bind(id).first();
  if (!project) return notFound();
  shape(project);
  const packet = await env.DB.prepare(
    "SELECT works, broken, vision, agent_context, provenance, handoff_rules, updated_at FROM packets WHERE project_id = ?"
  ).bind(id).first();
  const { results: lineage } = await env.DB.prepare(
    `SELECT u.handle, l.role, l.how, l.repo_full_name, l.started_at, l.ended_at
       FROM lineage l JOIN users u ON u.id = l.user_id
      WHERE l.project_id = ? ORDER BY l.started_at, l.id`
  ).bind(id).all();
  const record = await env.DB.prepare(
    "SELECT version, spdx_id, commit_sha, recorded_at FROM license_records WHERE project_id = ? ORDER BY version DESC LIMIT 1"
  ).bind(id).first();
  project.license_record = record || null;
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
  if (path === "/api/my/repos") return method === "GET" ? myRepos(env, await getSession(request, env)) : methodNotAllowed("GET");
  const repo = path.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/(access|listing-info)$/);
  if (repo) {
    if (method !== "GET") return methodNotAllowed("GET");
    let owner, name;
    try { owner = decodeURIComponent(repo[1]); name = decodeURIComponent(repo[2]); } catch { return notFound(); }
    const session = await getSession(request, env);
    return repo[3] === "access" ? repoAccessRoute(env, session, owner, name) : listingInfo(env, session, owner, name);
  }
  if (path === "/api/projects") return createListing(request, env, ctx, await getSession(request, env)); // POST only (see handleApi)
  const adopt = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/adopt$/);
  if (adopt) return method === "POST" ? adoptProject(request, env, ctx, await getSession(request, env), adopt[1]) : methodNotAllowed("POST");
  return null;
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "");

  if (path.startsWith("/api/auth/") || path === "/api/me" || path.startsWith("/api/repos/") || path.startsWith("/api/my/") ||
      (path === "/api/projects" && request.method === "POST") || /^\/api\/projects\/[^/]+\/adopt$/.test(path)) {
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
    } else if (/^\/api\/projects\/[^/]+\/license$/.test(path)) {
      response = await licenseRecord(env, path.split("/")[3]);
    } else if (path.startsWith("/api/license-text/")) {
      response = await licenseText(env, url, path.slice("/api/license-text/".length));
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
