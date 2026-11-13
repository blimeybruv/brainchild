// Screenshots for a project page: images only, small, stored in R2.
//
// Rules encoded here:
//   - Only the project's maintainer can add or remove screenshots, and GitHub is asked again
//     at that moment whether they still have admin rights on the repo (requireRepoAdmin).
//   - Only PNG, JPEG and WebP are accepted, judged by the file's first bytes, not its name.
//     SVG is refused because an SVG file can carry scripts.
//   - Each image is at most 2 MB and a project holds at most 6.
//   - Images are served with a fixed image type and "nosniff", so a browser never treats an
//     upload as a web page.

import { privateJson, json, NO_STORE, isSameOrigin } from "./http.js";
import { requireRepoAdmin } from "./github.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PER_PROJECT = 6;

function bad(error, status = 400) { return privateJson({ error }, status); }

function imageType(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return ["image/png", "png"];
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ["image/jpeg", "jpg"];
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ["image/webp", "webp"];
  return null;
}

async function maintainerOf(request, env, session, projectId) {
  if (!isSameOrigin(request)) return { response: bad("forbidden", 403) };
  if (!session) return { response: bad("not_signed_in", 401) };
  if (!/^[a-z0-9-]{1,80}$/.test(projectId)) return { response: bad("not_found", 404) };
  const p = await env.DB.prepare("SELECT id, owner_id, repo_full_name FROM projects WHERE id = ? AND hidden_at IS NULL").bind(projectId).first();
  if (!p) return { response: bad("not_found", 404) };
  if (p.owner_id !== session.userId) return { response: bad("not_maintainer", 403) };
  // Listings made before sign-in existed have no verified repo yet; the owner lists them again first.
  if (!p.repo_full_name) return { response: bad("listing_not_verified", 409) };
  const [owner, name] = p.repo_full_name.split("/");
  const own = await requireRepoAdmin(env, session, owner, name);
  if (own.response) return { response: own.response };
  return { project: p };
}

// POST /api/projects/<id>/screenshots  (the request body is the image itself)
export async function addScreenshot(request, env, session, projectId) {
  const m = await maintainerOf(request, env, session, projectId);
  if (m.response) return m.response;
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) return bad("image_too_large", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return bad("not_an_image", 415);
  if (bytes.length > MAX_BYTES) return bad("image_too_large", 413);
  const type = imageType(bytes);
  if (!type) return bad("not_an_image", 415);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM screenshots WHERE project_id = ?").bind(projectId).first();
  if (count.n >= MAX_PER_PROJECT) return bad("too_many_screenshots", 409);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let sha = "";
  for (const b of digest) sha += b.toString(16).padStart(2, "0");
  const same = await env.DB.prepare("SELECT id FROM screenshots WHERE project_id = ? AND sha256 = ?").bind(projectId, sha).first();
  if (same) return privateJson({ ok: true, id: same.id });
  const key = "screenshots/" + projectId + "/" + sha + "." + type[1];
  await env.BUILDS.put(key, bytes, { httpMetadata: { contentType: type[0] } });
  const r = await env.DB.prepare(
    "INSERT INTO screenshots (project_id, r2_key, content_type, bytes, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(projectId, key, type[0], bytes.length, sha, session.userId).run();
  await clearCached(request, projectId);
  return privateJson({ ok: true, id: r.meta.last_row_id }, 201);
}

// POST /api/screenshots/<id>/delete
export async function deleteScreenshot(request, env, session, id) {
  const shot = await env.DB.prepare("SELECT id, project_id, r2_key FROM screenshots WHERE id = ?").bind(id).first();
  if (!shot) return bad("not_found", 404);
  const m = await maintainerOf(request, env, session, shot.project_id);
  if (m.response) return m.response;
  await env.DB.prepare("DELETE FROM screenshots WHERE id = ?").bind(id).run();
  await env.BUILDS.delete(shot.r2_key);
  await clearCached(request, shot.project_id, id);
  return privateJson({ ok: true });
}

async function clearCached(request, projectId, shotId) {
  const origin = new URL(request.url).origin;
  const paths = ["/api/projects", "/api/projects/" + projectId];
  if (shotId) paths.push("/api/screenshots/" + shotId);
  await Promise.all(paths.map((p) => caches.default.delete(origin + p).catch(() => false)));
}

// GET /api/screenshots/<id> : public
export async function serveScreenshot(env, id) {
  const shot = await env.DB.prepare(
    "SELECT s.r2_key, s.content_type FROM screenshots s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.hidden_at IS NULL"
  ).bind(id).first();
  const obj = shot ? await env.BUILDS.get(shot.r2_key) : null;
  if (!obj) return json({ error: "not_found" }, 404, NO_STORE);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": shot.content_type, // from our own check of the file, never from the uploader
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      // Kept short so a deleted or removed image disappears everywhere within five minutes.
      "cache-control": "public, max-age=300"
    }
  });
}
