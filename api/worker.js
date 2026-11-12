// Brainchild Worker: the main script of the site Worker (see wrangler.jsonc).
// Requests to /api/* come here first; everything else is a static file from site/.
// Bindings: DB -> D1 "brainchild-db", BUILDS -> R2 "brainchild-builds", ASSETS -> site/
// The API is read-only (v1).

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "public, max-age=60"
};

const PROJECT_FIELDS =
  "id, title, kind, genre, status, base_game, tech, browser, license, note, tone, featured, repo_url, handed_off_at, updated_at";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function notFound() {
  return json({ error: "not_found" }, 404, { "cache-control": "no-store" });
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

async function handleApi(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD", "cache-control": "no-store" });
  }

  // Serve from Cloudflare's edge cache when we can, to save database reads.
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let response;
  try {
    if (path === "/api/health") {
      response = json({ ok: true }, 200, { "cache-control": "no-store" });
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
    return json({ error: "server_error" }, 500, { "cache-control": "no-store" });
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
