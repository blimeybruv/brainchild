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
//   POST /api/projects/<id>/edit                          the maintainer edits the page
//   POST /api/projects/<id>/adopt                         take a project on
//   GET  /api/projects/<id>/license                       public license record, cached for 60s
//   GET  /api/license-text/<fingerprint>                  the stored copy of a license file
//   GET/POST /api/projects/<id>/comments                  discussion (community.js)
//   POST /api/comments/<id>/like | pin | delete
//   POST /api/reports                                     report a project or a comment
//   GET  /api/mod/reports, POST /api/mod/reports/<id>/resolve, POST /api/mod/actions/<id>/appeal   moderators only
//   GET  /api/my/notices, POST /api/my/notices/<id>/appeal
//   POST /api/projects/<id>/screenshots, POST /api/screenshots/<id>/delete   maintainer only (screenshots.js)
//   GET  /api/screenshots/<id>                            public image
//   POST /api/projects/<id>/builds, PUT .../builds/<build>/files?path=, POST .../builds/<build>/activate,
//   POST /api/projects/<id>/builds/remove                 hosted browser build, maintainer only (builds.js)
//   GET/POST /api/votes, POST /api/proposals, POST /api/proposals/<id>/delete   monthly community vote (votes.js)

import { json, privateJson, NO_STORE } from "./http.js";
import { login, callback, logout, me, getSession } from "./auth.js";
import { repoAccessRoute } from "./github.js";
import { myRepos, listingInfo, createListing, editProject, adoptProject, licenseRecord, licenseText } from "./listings.js";
import { listComments, postComment, commentAction, postReport, modQueue, modResolve, modAppeal, myNotices, appealNotice } from "./community.js";
import { addScreenshot, deleteScreenshot, serveScreenshot } from "./screenshots.js";
import { listVotes, castVote, propose, withdrawProposal } from "./votes.js";
import { startBuild, putBuildFile, activateBuild, removeBuild, playUrl } from "./builds.js";

const PROJECT_FIELDS =
  "p.id, p.title, p.kind, p.genre, p.status, p.base_game, p.tech, p.browser, p.license, p.note, p.tone, p.featured, p.repo_url, " +
  "p.handed_off_at, p.updated_at, p.created_at, p.intent, p.rating, p.content_notes, p.assets_license, p.name_rights, p.open_to_transfer, " +
  "u.handle AS owner, (u.github_id IS NOT NULL AND p.repo_id IS NOT NULL) AS owner_verified"
  + ", (SELECT s.id FROM screenshots s WHERE s.project_id = p.id ORDER BY s.id LIMIT 1) AS shot"
  + ", EXISTS (SELECT 1 FROM builds b WHERE b.project_id = p.id AND b.status = 'active') AS has_build";
// Projects removed by a moderator are hidden everywhere.
const PROJECT_FROM = "FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.hidden_at IS NULL";

function shape(row) {
  try { row.content_notes = JSON.parse(row.content_notes || "[]"); } catch { row.content_notes = []; }
  row.play_url = playUrl(row.id, !!row.has_build); // where the hosted build runs, if there is one
  delete row.has_build;
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
  const project = await env.DB.prepare(`SELECT ${PROJECT_FIELDS} ${PROJECT_FROM} AND p.id = ?`).bind(id).first();
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
  const { results: shots } = await env.DB.prepare("SELECT id FROM screenshots WHERE project_id = ? ORDER BY id").bind(id).all();
  project.screenshots = shots.map((x) => x.id);
  // The public change log: which fields changed and when (never the old text).
  const { results: changes } = await env.DB.prepare(
    "SELECT changed_at, fields FROM project_changes WHERE project_id = ? ORDER BY id DESC LIMIT 15"
  ).bind(id).all();
  project.changes = changes.map((c) => { let fields = []; try { fields = JSON.parse(c.fields); } catch { fields = []; } return { at: c.changed_at, fields }; });
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
  const edit = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/edit$/);
  if (edit) return method === "POST" ? editProject(request, env, ctx, await getSession(request, env), edit[1]) : methodNotAllowed("POST");
  const adopt = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/adopt$/);
  if (adopt) return method === "POST" ? adoptProject(request, env, ctx, await getSession(request, env), adopt[1]) : methodNotAllowed("POST");

  const session = await getSession(request, env);
  let m = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/comments$/);
  if (m) return method === "GET" ? listComments(env, session, m[1]) : method === "POST" ? postComment(request, env, session, m[1]) : methodNotAllowed("GET, POST");
  m = path.match(/^\/api\/comments\/(\d{1,12})\/(like|pin|delete)$/);
  if (m) return method === "POST" ? commentAction(request, env, session, Number(m[1]), m[2]) : methodNotAllowed("POST");
  if (path === "/api/reports") return method === "POST" ? postReport(request, env, session) : methodNotAllowed("POST");
  if (path === "/api/mod/reports") return method === "GET" ? modQueue(request, env, session, url) : methodNotAllowed("GET");
  m = path.match(/^\/api\/mod\/reports\/(\d{1,12})\/resolve$/);
  if (m) return method === "POST" ? modResolve(request, env, session, Number(m[1])) : methodNotAllowed("POST");
  m = path.match(/^\/api\/mod\/actions\/(\d{1,12})\/appeal$/);
  if (m) return method === "POST" ? modAppeal(request, env, session, Number(m[1])) : methodNotAllowed("POST");
  if (path === "/api/my/notices") return method === "GET" ? myNotices(env, session) : methodNotAllowed("GET");
  m = path.match(/^\/api\/my\/notices\/(\d{1,12})\/appeal$/);
  if (m) return method === "POST" ? appealNotice(request, env, session, Number(m[1])) : methodNotAllowed("POST");
  m = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/builds$/);
  if (m) return method === "POST" ? startBuild(request, env, ctx, session, m[1]) : methodNotAllowed("POST");
  m = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/builds\/remove$/);
  if (m) return method === "POST" ? removeBuild(request, env, ctx, session, m[1]) : methodNotAllowed("POST");
  m = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/builds\/([a-f0-9]{20})\/files$/);
  if (m) return method === "PUT" ? putBuildFile(request, env, session, m[1], m[2], url) : methodNotAllowed("PUT");
  m = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/builds\/([a-f0-9]{20})\/activate$/);
  if (m) return method === "POST" ? activateBuild(request, env, ctx, session, m[1], m[2]) : methodNotAllowed("POST");
  if (path === "/api/votes") return method === "GET" ? listVotes(env, session) : method === "POST" ? castVote(request, env, session) : methodNotAllowed("GET, POST");
  if (path === "/api/proposals") return method === "POST" ? propose(request, env, session) : methodNotAllowed("POST");
  m = path.match(/^\/api\/proposals\/(\d{1,12})\/delete$/);
  if (m) return method === "POST" ? withdrawProposal(request, env, session, Number(m[1])) : methodNotAllowed("POST");
  m = path.match(/^\/api\/projects\/([a-z0-9-]{1,80})\/screenshots$/);
  if (m) return method === "POST" ? addScreenshot(request, env, session, m[1]) : methodNotAllowed("POST");
  m = path.match(/^\/api\/screenshots\/(\d{1,12})\/delete$/);
  if (m) return method === "POST" ? deleteScreenshot(request, env, session, Number(m[1])) : methodNotAllowed("POST");
  return null;
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "");

  if (path.startsWith("/api/auth/") || path === "/api/me" || path.startsWith("/api/repos/") || path.startsWith("/api/my/") ||
      (path === "/api/projects" && request.method === "POST") || /^\/api\/projects\/[^/]+\/(adopt|edit|comments|screenshots|builds)(\/.*)?$/.test(path) ||
      path.startsWith("/api/comments/") || path === "/api/reports" || path === "/api/votes" || path.startsWith("/api/proposals") || path.startsWith("/api/mod/") || /^\/api\/screenshots\/\d+\/delete$/.test(path)) {
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
  // A fault in the cache must never take the API down, so it is treated as a miss.
  const cache = caches.default;
  let cached = null;
  try { cached = await cache.match(request); } catch { cached = null; }
  if (cached) return cached;

  let response;
  try {
    if (path === "/api/health") {
      response = json({ ok: true }, 200, NO_STORE);
    } else if (path === "/api/projects") {
      response = await listProjects(env);
    } else if (/^\/api\/projects\/[^/]+\/license$/.test(path)) {
      response = await licenseRecord(env, ctx, path.split("/")[3]);
    } else if (/^\/api\/screenshots\/\d{1,12}$/.test(path)) {
      response = await serveScreenshot(env, Number(path.split("/")[3]));
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
    ctx.waitUntil(cache.put(request, response.clone()).catch(() => {}));
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
