// Uploading a hosted browser build (a static folder such as a Vite dist/).
//
// Rules encoded here:
//   - Only the project's maintainer can upload, and GitHub is asked again whether they still
//     have admin rights on the repo when a build is started and when it goes live.
//   - Files go to R2 one at a time. Only the kinds of file in build-rules.js are accepted,
//     hidden files are refused, and each file, each build and all builds together have size caps.
//   - Nothing is served until the maintainer makes the build live, and a build needs an
//     index.html. Builds are served only from brainwave.nexus (builds-worker/), never from here.

import { privateJson, isSameOrigin } from "./http.js";
import { requireRepoAdmin } from "./github.js";
import { MAX_FILE_BYTES, MAX_BUILD_BYTES, MAX_BUILD_FILES, MAX_ALL_BUILDS_BYTES, cleanPath, typeFor, hostFor } from "./build-rules.js";

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
function nowText() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// The address a project's live build is played at, or null.
export function playUrl(projectId, hasActiveBuild) {
  const host = hasActiveBuild ? hostFor(projectId) : null;
  return host ? "https://" + host + "/" : null;
}

async function maintainer(request, env, session, projectId, askGitHub) {
  if (!isSameOrigin(request)) return { response: bad("forbidden", 403) };
  if (!session) return { response: bad("not_signed_in", 401) };
  const p = await env.DB.prepare("SELECT id, owner_id, repo_full_name, kind FROM projects WHERE id = ? AND hidden_at IS NULL").bind(projectId).first();
  if (!p) return { response: bad("not_found", 404) };
  if (p.owner_id !== session.userId) return { response: bad("not_maintainer", 403) };
  if (!p.repo_full_name) return { response: bad("listing_not_verified", 409) };
  if (askGitHub) {
    const [owner, name] = p.repo_full_name.split("/");
    const own = await requireRepoAdmin(env, session, owner, name);
    if (own.response) return { response: own.response };
  }
  return { project: p };
}

// Delete every stored file of one build (R2 lists and deletes up to 1000 keys at a time).
async function deleteFiles(env, projectId, buildId) {
  const prefix = "builds/" + projectId + "/" + buildId + "/";
  for (let i = 0; i < 5; i++) {
    const page = await env.BUILDS.list({ prefix, limit: 1000 });
    if (!page.objects.length) return;
    await env.BUILDS.delete(page.objects.map((o) => o.key));
    if (!page.truncated) return;
  }
}

// POST /api/projects/<id>/builds : start a new upload
export async function startBuild(request, env, ctx, session, projectId) {
  const m = await maintainer(request, env, session, projectId, true);
  if (m.response) return m.response;
  if (!hostFor(projectId)) return bad("project_id_too_long", 409);
  const total = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM builds WHERE status IN ('uploading', 'active')").first();
  if (total.n + MAX_BUILD_BYTES > MAX_ALL_BUILDS_BYTES) return bad("storage_full", 507);
  // Starting again abandons any half-finished upload for this project.
  const { results: stale } = await env.DB.prepare("SELECT id FROM builds WHERE project_id = ? AND status = 'uploading'").bind(projectId).all();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await env.DB.batch([
    env.DB.prepare("UPDATE builds SET status = 'removed' WHERE project_id = ? AND status = 'uploading'").bind(projectId),
    env.DB.prepare("INSERT INTO builds (id, project_id, status, created_by, created_at) VALUES (?, ?, 'uploading', ?, ?)").bind(id, projectId, session.userId, nowText())
  ]);
  ctx.waitUntil(Promise.all(stale.map((b) => deleteFiles(env, projectId, b.id))).catch(() => {}));
  return privateJson({ ok: true, build: id, limits: { file: MAX_FILE_BYTES, build: MAX_BUILD_BYTES, files: MAX_BUILD_FILES } }, 201);
}

// PUT /api/projects/<id>/builds/<build>/files?path=assets/main.js : the body is the file
export async function putBuildFile(request, env, session, projectId, buildId, url) {
  const m = await maintainer(request, env, session, projectId, false);
  if (m.response) return m.response;
  const path = cleanPath(url.searchParams.get("path") || "");
  if (!path) return bad("bad_file_path", 400);
  const type = typeFor(path);
  if (!type) return bad("file_type_not_allowed", 415, { path });
  const size = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(size) || size < 0 || !request.body) return bad("length_required", 411);
  if (size > MAX_FILE_BYTES) return bad("file_too_large", 413, { path });
  // Reserve room in the build first; this fails if the build is full, finished, or someone else's.
  const claim = await env.DB.prepare(
    `UPDATE builds SET files = files + 1, bytes = bytes + ?1
      WHERE id = ?2 AND project_id = ?3 AND status = 'uploading' AND created_by = ?4 AND files < ?5 AND bytes + ?1 <= ?6`
  ).bind(size, buildId, projectId, session.userId, MAX_BUILD_FILES, MAX_BUILD_BYTES).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    const b = await env.DB.prepare("SELECT status, files, bytes FROM builds WHERE id = ? AND project_id = ?").bind(buildId, projectId).first();
    if (!b || b.status !== "uploading") return bad("not_found", 404);
    return bad(b.files >= MAX_BUILD_FILES ? "too_many_files" : "build_too_large", 413);
  }
  const key = "builds/" + projectId + "/" + buildId + "/" + path;
  let stored = null;
  try {
    stored = await env.BUILDS.put(key, request.body, { httpMetadata: { contentType: type } });
  } catch (err) {
    console.error("build upload failed:", err && err.message);
  }
  if (!stored || stored.size !== size) {
    if (stored) await env.BUILDS.delete(key);
    await env.DB.prepare("UPDATE builds SET files = files - 1, bytes = bytes - ? WHERE id = ?").bind(size, buildId).run();
    return bad("upload_failed", 400, { path });
  }
  return privateJson({ ok: true, path, bytes: size }, 201);
}

// POST /api/projects/<id>/builds/<build>/activate : make the uploaded build the live one
export async function activateBuild(request, env, ctx, session, projectId, buildId) {
  const m = await maintainer(request, env, session, projectId, true);
  if (m.response) return m.response;
  const b = await env.DB.prepare("SELECT id, files FROM builds WHERE id = ? AND project_id = ? AND status = 'uploading' AND created_by = ?")
    .bind(buildId, projectId, session.userId).first();
  if (!b) return bad("not_found", 404);
  if (!(await env.BUILDS.head("builds/" + projectId + "/" + buildId + "/index.html"))) return bad("no_index_html", 409);
  const { results: old } = await env.DB.prepare("SELECT id FROM builds WHERE project_id = ? AND status = 'active'").bind(projectId).all();
  const now = nowText();
  await env.DB.batch([
    env.DB.prepare("UPDATE builds SET status = 'replaced' WHERE project_id = ? AND status = 'active'").bind(projectId),
    env.DB.prepare("UPDATE builds SET status = 'active', activated_at = ? WHERE id = ?").bind(now, buildId),
    env.DB.prepare("UPDATE projects SET browser = 1, updated_at = ? WHERE id = ?").bind(now, projectId)
  ]);
  ctx.waitUntil(Promise.all(old.map((x) => deleteFiles(env, projectId, x.id))).catch(() => {}));
  ctx.waitUntil(clearCached(request, projectId));
  return privateJson({ ok: true, play_url: playUrl(projectId, true) });
}

// POST /api/projects/<id>/builds/remove : take the live build down
export async function removeBuild(request, env, ctx, session, projectId) {
  const m = await maintainer(request, env, session, projectId, false);
  if (m.response) return m.response;
  const { results: old } = await env.DB.prepare("SELECT id FROM builds WHERE project_id = ? AND status IN ('active', 'uploading')").bind(projectId).all();
  await env.DB.prepare("UPDATE builds SET status = 'removed' WHERE project_id = ? AND status IN ('active', 'uploading')").bind(projectId).run();
  ctx.waitUntil(Promise.all(old.map((x) => deleteFiles(env, projectId, x.id))).catch(() => {}));
  ctx.waitUntil(clearCached(request, projectId));
  return privateJson({ ok: true });
}

async function clearCached(request, projectId) {
  const origin = new URL(request.url).origin;
  await Promise.all(["/api/projects", "/api/projects/" + projectId].map((p) => caches.default.delete(origin + p).catch(() => false)));
}
