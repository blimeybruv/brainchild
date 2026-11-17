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
//   - Screenshots are post-moderated: they go live at once and can be reported. The exception (owner
//     request, 17 Nov): an upload is held for a moderator when the uploader's linked GitHub or GitLab
//     account is under 7 days old, or when it is their first upload and their Brainchild account is
//     under 24 hours old. A held image is shown only to the uploader, the maintainer and moderators,
//     never cached. Once a moderator approves one, that person's later uploads go live at once.

import { privateJson, json, NO_STORE, isSameOrigin } from "./http.js";
import { requireProjectAdmin } from "./forge.js";
import { isModerator } from "./auth.js";

async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (raw.length > 20000) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

const PROVIDER_MIN_DAYS = 7;
const FIRST_UPLOAD_MIN_HOURS = 24;

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
  const p = await env.DB.prepare("SELECT id, owner_id, repo_full_name, repo_id, repo_host FROM projects WHERE id = ? AND hidden_at IS NULL").bind(projectId).first();
  if (!p) return { response: bad("not_found", 404) };
  if (p.owner_id !== session.userId) return { response: bad("not_maintainer", 403) };
  // Listings made before sign-in existed have no verified repo yet; the owner lists them again first.
  if (!p.repo_full_name) return { response: bad("listing_not_verified", 409) };
  const own = await requireProjectAdmin(env, session, p);
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
  const same = await env.DB.prepare("SELECT id, held_at FROM screenshots WHERE project_id = ? AND sha256 = ?").bind(projectId, sha).first();
  if (same) return privateJson({ ok: true, id: same.id, held: !!same.held_at });
  const hold = isModerator(env, session) ? null : await holdReason(env, session.userId);
  const key = "screenshots/" + projectId + "/" + sha + "." + type[1];
  await env.BUILDS.put(key, bytes, { httpMetadata: { contentType: type[0] } });
  const r = await env.DB.prepare(
    "INSERT INTO screenshots (project_id, r2_key, content_type, bytes, sha256, uploaded_by, held_at, held_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(projectId, key, type[0], bytes.length, sha, session.userId, hold ? nowText() : null, hold).run();
  if (!hold) await clearCached(request, projectId);
  return privateJson({ ok: true, id: r.meta.last_row_id, held: !!hold }, 201);
}

function nowText() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function hoursSince(t) { return t ? (Date.now() - Date.parse(String(t).replace(" ", "T") + "Z")) / 3600000 : null; }

// Why this person's upload should wait for a moderator, or null for none.
async function holdReason(env, userId) {
  const u = await env.DB.prepare("SELECT created_at, screenshots_trusted_at FROM users WHERE id = ?").bind(userId).first();
  if (!u || u.screenshots_trusted_at) return null;
  // The account creation date GitHub or GitLab gave at sign-in (stored for the vote-rigging signals).
  // An unknown date (a self-hosted GitLab, say) doesn't count against anyone.
  const { results: ids } = await env.DB.prepare("SELECT provider_created_at FROM identities WHERE user_id = ?").bind(userId).all();
  if (ids.some((i) => { const h = hoursSince(i.provider_created_at); return h !== null && h < PROVIDER_MIN_DAYS * 24; })) return "new_provider_account";
  const before = await env.DB.prepare("SELECT 1 AS x FROM screenshots WHERE uploaded_by = ? LIMIT 1").bind(userId).first();
  const age = hoursSince(u.created_at);
  if (!before && age !== null && age < FIRST_UPLOAD_MIN_HOURS) return "first_upload_new_account";
  return null;
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
    "SELECT s.r2_key, s.content_type FROM screenshots s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.hidden_at IS NULL AND s.held_at IS NULL"
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

// ---------- held screenshots ----------

// GET /api/screenshots/<id>/held : a held image, for its uploader, the project's maintainer and moderators.
// Never cached anywhere, so it disappears the moment it is approved or rejected.
export async function serveHeldScreenshot(env, session, id) {
  const none = () => privateJson({ error: "not_found" }, 404);
  if (!session) return none();
  const shot = await env.DB.prepare(
    "SELECT s.r2_key, s.content_type, s.uploaded_by, p.owner_id FROM screenshots s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.held_at IS NOT NULL"
  ).bind(id).first();
  if (!shot || (shot.uploaded_by !== session.userId && shot.owner_id !== session.userId && !isModerator(env, session))) return none();
  const obj = await env.BUILDS.get(shot.r2_key);
  if (!obj) return none();
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": shot.content_type,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store"
    }
  });
}

// GET /api/projects/<id>/screenshots : the maintainer's (or a moderator's) held images for a project.
export async function heldForProject(env, session, projectId) {
  if (!session) return bad("not_signed_in", 401);
  if (!/^[a-z0-9-]{1,80}$/.test(projectId)) return bad("not_found", 404);
  const p = await env.DB.prepare("SELECT owner_id FROM projects WHERE id = ? AND hidden_at IS NULL").bind(projectId).first();
  if (!p) return bad("not_found", 404);
  if (p.owner_id !== session.userId && !isModerator(env, session)) return bad("not_maintainer", 403);
  const { results } = await env.DB.prepare("SELECT id, created_at FROM screenshots WHERE project_id = ? AND held_at IS NOT NULL ORDER BY id").bind(projectId).all();
  return privateJson({ held: results });
}

// For the moderation queue: every held screenshot, oldest first, with why it was held.
export async function listHeld(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.project_id, s.held_at, s.held_reason, s.bytes, p.title AS project_title, u.handle AS uploader, u.created_at AS account_created,
            (SELECT json_group_array(json_object('provider', i.provider, 'created', i.provider_created_at)) FROM identities i WHERE i.user_id = s.uploaded_by) AS ids
       FROM screenshots s JOIN projects p ON p.id = s.project_id LEFT JOIN users u ON u.id = s.uploaded_by
      WHERE s.held_at IS NOT NULL ORDER BY s.held_at LIMIT 200`
  ).all();
  return results.map((r) => {
    let ids = [];
    try { ids = JSON.parse(r.ids || "[]"); } catch { ids = []; }
    const days = (t) => { const h = hoursSince(t); return h === null ? null : Math.floor(h / 24); };
    return { id: r.id, project_id: r.project_id, project_title: r.project_title, uploader: r.uploader, held_at: r.held_at, held_reason: r.held_reason, bytes: r.bytes,
      account_age_hours: Math.floor(hoursSince(r.account_created) || 0), linked: ids.map((i) => ({ provider: i.provider, age_days: days(i.created) })) };
  });
}

function modGuard(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!isModerator(env, session)) return bad("not_moderator", 403);
  return null;
}

// POST /api/mod/screenshots/<id>/approve : publish it, and trust the uploader's later screenshots.
export async function approveHeld(request, env, session, id) {
  const stop = modGuard(request, env, session);
  if (stop) return stop;
  const shot = await env.DB.prepare("SELECT id, project_id, uploaded_by FROM screenshots WHERE id = ? AND held_at IS NOT NULL").bind(id).first();
  if (!shot) return bad("already_resolved", 409);
  const now = nowText();
  await env.DB.batch([
    env.DB.prepare("UPDATE screenshots SET held_at = NULL, approved_by = ?, approved_at = ? WHERE id = ?").bind(session.userId, now, id),
    env.DB.prepare("UPDATE users SET screenshots_trusted_at = COALESCE(screenshots_trusted_at, ?) WHERE id = ?").bind(now, shot.uploaded_by)
  ]);
  await clearCached(request, shot.project_id, id);
  return privateJson({ ok: true });
}

const REJECT_CATEGORIES = ["sexual", "harass", "license", "malware", "spam", "other"];

// POST /api/mod/screenshots/<id>/reject  { ground, category, reasons } : delete it, and tell the
// uploader why (a statement of reasons on their account page, like other decisions).
export async function rejectHeld(request, env, session, id) {
  const stop = modGuard(request, env, session);
  if (stop) return stop;
  const body = await readJson(request);
  const reasons = body && typeof body.reasons === "string" ? body.reasons.replace(/\r\n?/g, "\n").trim().slice(0, 2000) : "";
  const ground = body && (body.ground === "illegal" || body.ground === "terms") ? body.ground : null;
  const category = body && REJECT_CATEGORIES.includes(body.category) ? body.category : null;
  const fields = [];
  if (reasons.length < 10) fields.push("reasons");
  if (!ground) fields.push("ground");
  if (!category) fields.push("category");
  if (fields.length) return privateJson({ error: "invalid_fields", fields }, 400);
  const shot = await env.DB.prepare("SELECT id, project_id, r2_key, uploaded_by FROM screenshots WHERE id = ? AND held_at IS NOT NULL").bind(id).first();
  if (!shot) return bad("already_resolved", 409);
  const now = nowText();
  const r = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO moderation_actions (target_type, project_id, affected_user_id, action, ground, category, reasons, automated, moderator_id, created_at)
       VALUES ('screenshot', ?, ?, 'remove', ?, ?, ?, 0, ?, ?)`
    ).bind(shot.project_id, shot.uploaded_by, ground, category, reasons, session.userId, now),
    env.DB.prepare("DELETE FROM screenshots WHERE id = ? AND held_at IS NOT NULL").bind(id)
  ]);
  if (r[1].meta && r[1].meta.changes === 1) await env.BUILDS.delete(shot.r2_key);
  return privateJson({ ok: true, action_id: r[0].meta.last_row_id });
}
