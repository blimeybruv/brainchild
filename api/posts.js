// Blog posts (HANDOFF.md, "moderator blog posts, and Pitch a post").
//
//   - Moderators write, edit, publish, unpublish and delete posts in the moderation area.
//   - A post's author is a member chosen by handle, or nobody for a site post (shown as "Brainchild").
//     A post is only attributed to someone who submitted it or agreed to it: when the author isn't the
//     person whose pitch or report it came from, the moderator has to confirm they agreed.
//   - Who really created or changed a post, and when, is logged privately (post_edits).
//   - The body is plain text with a small formatting subset (paragraphs, # headings, - lists,
//     `code` and [links](https://...)). It is stored as typed and turned into page elements by the
//     browser; it never becomes HTML.
//   - Members pitch a post (topic, title, draft text). A moderator turns the pitch into a draft, edits
//     it and publishes it with the pitcher as author, or declines it with a note. The pitcher sees what
//     happened on their account page.

import { json, privateJson, isSameOrigin, NO_STORE } from "./http.js";
import { isModerator } from "./auth.js";

export const TOPICS = ["Community project", "Handoff story", "Guide", "Site news"];
const MAX_BODY = 20000;

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
function now() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function clean(v, max, multiline) {
  if (typeof v !== "string") return null;
  let s = v.replace(/\r\n?/g, "\n");
  s = multiline ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : s.replace(/[\u0000-\u001f\u007f]+/g, " ");
  s = s.trim();
  return s.length <= max ? s : null;
}
async function body(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY * 2) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}
function modGuard(request, env, session, write) {
  if (write && !isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!isModerator(env, session)) return bad("not_moderator", 403);
  return null;
}
async function forget(request) {
  const origin = new URL(request.url).origin;
  await caches.default.delete(origin + "/api/posts").catch(() => false);
}
function log(env, postId, title, userId, action) {
  return env.DB.prepare("INSERT INTO post_edits (post_id, title, user_id, action, at) VALUES (?, ?, ?, ?, ?)").bind(postId, title, userId, action, now());
}
async function uniqueSlug(env, title, selfId) {
  const base = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "post").slice(0, 60);
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : base + "-" + i;
    const taken = await env.DB.prepare("SELECT id FROM posts WHERE slug = ? AND id IS NOT ?").bind(slug, selfId || null).first();
    if (!taken) return slug;
  }
  return base + "-" + crypto.randomUUID().slice(0, 8);
}

// ---------- public ----------

// GET /api/posts : published posts, newest first
export async function listPosts(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.topic, p.title, p.excerpt, p.published_at, u.handle AS author
       FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.published_at IS NOT NULL ORDER BY p.published_at DESC LIMIT 100`
  ).all();
  return json({ posts: results });
}

// GET /api/posts/<slug>
export async function getPost(env, slug) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: "not_found" }, 404, NO_STORE);
  const p = await env.DB.prepare(
    `SELECT p.slug, p.topic, p.title, p.excerpt, p.body, p.published_at, p.updated_at, u.handle AS author
       FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.slug = ? AND p.published_at IS NOT NULL`
  ).bind(slug).first();
  if (!p) return json({ error: "not_found" }, 404, NO_STORE);
  return json({ post: p });
}

// ---------- moderators ----------

// GET /api/mod/posts : every post (drafts too), open pitches and the edit log
export async function modPosts(request, env, session) {
  const stop = modGuard(request, env, session, false);
  if (stop) return stop;
  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.topic, p.title, p.excerpt, p.body, p.published_at, p.created_at, p.updated_at, p.source_kind, p.source_id, u.handle AS author
       FROM posts p LEFT JOIN users u ON u.id = p.author_id ORDER BY COALESCE(p.updated_at, p.created_at, p.published_at) DESC LIMIT 200`
  ).all();
  const { results: pitches } = await env.DB.prepare(
    `SELECT p.id, p.topic, p.title, p.body, p.created_at, u.handle AS pitched_by FROM pitches p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'open' ORDER BY p.created_at LIMIT 100`
  ).all();
  const { results: edits } = await env.DB.prepare(
    "SELECT e.post_id, e.title, e.action, e.at, u.handle AS by FROM post_edits e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 100"
  ).all();
  return privateJson({ posts, pitches, edits, topics: TOPICS });
}

// Who submitted the text a post came from, if anyone (for the consent rule).
async function submitter(env, kind, id) {
  if (kind === "pitch") return (await env.DB.prepare("SELECT user_id FROM pitches WHERE id = ?").bind(id).first() || {}).user_id || null;
  if (kind === "report") return (await env.DB.prepare("SELECT reporter_id AS user_id FROM reports WHERE id = ?").bind(id).first() || {}).user_id || null;
  return null; // outside reports have no account behind them
}

// POST /api/mod/posts  { id?, topic, title, excerpt, body, author ("" = Brainchild), consent }
export async function savePost(request, env, session) {
  const stop = modGuard(request, env, session, true);
  if (stop) return stop;
  const b = await body(request);
  if (!b) return bad("bad_request");
  const topic = TOPICS.includes(b.topic) ? b.topic : null, title = clean(b.title, 140), excerpt = clean(b.excerpt, 300), text = clean(b.body, MAX_BODY, true);
  const fields = [];
  if (!topic) fields.push("topic");
  if (!title || title.length < 3) fields.push("title");
  if (excerpt === null || excerpt.length < 10) fields.push("excerpt");
  if (text === null) fields.push("body");
  if (fields.length) return bad("invalid_fields", 400, { fields });
  const existing = Number.isSafeInteger(b.id) ? await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(b.id).first() : null;
  if (b.id !== undefined && b.id !== null && !existing) return bad("not_found", 404);
  // Author: a member by handle, or nobody (a site post).
  let authorId = null;
  const handle = typeof b.author === "string" ? b.author.trim().replace(/^@/, "") : "";
  if (handle) {
    const u = await env.DB.prepare("SELECT id FROM users WHERE handle = ? COLLATE NOCASE").bind(handle).first();
    if (!u) return bad("author_not_found", 404);
    authorId = u.id;
  }
  const sourceKind = existing ? existing.source_kind : null, sourceId = existing ? existing.source_id : null;
  const authorChanged = !existing || (existing.author_id || null) !== authorId;
  if (authorId && authorChanged && b.consent !== true) {
    // Named authors must have submitted the text or agreed to be named.
    if (!sourceKind || (await submitter(env, sourceKind, sourceId)) !== authorId) return bad("author_consent_needed", 409);
  }
  const t = now();
  if (existing) {
    await env.DB.batch([
      env.DB.prepare("UPDATE posts SET topic = ?, title = ?, excerpt = ?, body = ?, author_id = ?, updated_at = ? WHERE id = ?")
        .bind(topic, title, excerpt, text, authorId, t, existing.id),
      log(env, existing.id, title, session.userId, "edit"),
      ...(authorChanged ? [log(env, existing.id, title, session.userId, "author")] : [])
    ]);
    if (existing.published_at) await forget(request);
    return privateJson({ ok: true, id: existing.id, slug: existing.slug });
  }
  const slug = await uniqueSlug(env, title, null);
  const r = await env.DB.prepare("INSERT INTO posts (slug, topic, title, excerpt, body, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(slug, topic, title, excerpt, text, authorId, t, t).run();
  await log(env, r.meta.last_row_id, title, session.userId, "create").run();
  return privateJson({ ok: true, id: r.meta.last_row_id, slug }, 201);
}

// POST /api/mod/posts/<id>/publish | unpublish | delete
export async function postAction(request, env, session, id, action) {
  const stop = modGuard(request, env, session, true);
  if (stop) return stop;
  const p = await env.DB.prepare("SELECT id, title, published_at, source_kind, source_id FROM posts WHERE id = ?").bind(id).first();
  if (!p) return bad("not_found", 404);
  const t = now();
  if (action === "publish") {
    if (p.published_at) return bad("already_published", 409);
    const steps = [env.DB.prepare("UPDATE posts SET published_at = ?, updated_at = ? WHERE id = ?").bind(t, t, id), log(env, id, p.title, session.userId, "publish")];
    await env.DB.batch(steps);
  } else if (action === "unpublish") {
    if (!p.published_at) return bad("not_published", 409);
    await env.DB.batch([env.DB.prepare("UPDATE posts SET published_at = NULL, updated_at = ? WHERE id = ?").bind(t, id), log(env, id, p.title, session.userId, "unpublish")]);
  } else {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
      env.DB.prepare("UPDATE pitches SET post_id = NULL WHERE post_id = ?").bind(id),
      log(env, id, p.title, session.userId, "delete")
    ]);
  }
  await forget(request);
  return privateJson({ ok: true });
}

// ---------- pitches and drafts from reports ----------

// POST /api/pitches  { topic, title, body } : a member pitches a post
export async function pitch(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const b = await body(request);
  if (!b) return bad("bad_request");
  const topic = TOPICS.includes(b.topic) ? b.topic : null, title = clean(b.title, 140), text = clean(b.body, MAX_BODY, true);
  const fields = [];
  if (!topic) fields.push("topic");
  if (!title || title.length < 3) fields.push("title");
  if (!text || text.length < 30) fields.push("body");
  if (fields.length) return bad("invalid_fields", 400, { fields });
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM pitches WHERE user_id = ? AND created_at > datetime('now', '-1 day')").bind(session.userId).first();
  if (today.n >= 3) return bad("slow_down", 429);
  const r = await env.DB.prepare("INSERT INTO pitches (user_id, topic, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(session.userId, topic, title, text, now()).run();
  return privateJson({ ok: true, id: r.meta.last_row_id }, 201);
}

function excerptOf(text) {
  const first = text.split(/\n\s*\n/).find((p) => p.trim() && !/^#/.test(p.trim())) || text;
  const flat = first.replace(/[`*_#>\[\]]/g, "").replace(/\s+/g, " ").trim();
  return (flat.length > 200 ? flat.slice(0, 197).replace(/\s+\S*$/, "") + "…" : flat) || "A post for the Brainchild blog.";
}

async function draftFrom(env, session, { topic, title, text, authorId, kind, id }) {
  const t = now(), slug = await uniqueSlug(env, title, null);
  const r = await env.DB.prepare(
    "INSERT INTO posts (slug, topic, title, excerpt, body, author_id, created_at, updated_at, source_kind, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(slug, topic, title, excerptOf(text), text, authorId, t, t, kind, id).run();
  await log(env, r.meta.last_row_id, title, session.userId, "create").run();
  return r.meta.last_row_id;
}

// POST /api/mod/pitches/<id>/draft | decline  ({ note } for decline)
export async function pitchAction(request, env, session, id, action) {
  const stop = modGuard(request, env, session, true);
  if (stop) return stop;
  const p = await env.DB.prepare("SELECT * FROM pitches WHERE id = ?").bind(id).first();
  if (!p) return bad("not_found", 404);
  if (p.status !== "open") return bad("already_resolved", 409);
  if (action === "decline") {
    const b = await body(request);
    const note = b ? clean(b.note === undefined || b.note === null ? "" : b.note, 1000, true) : "";
    if (note === null) return bad("invalid_fields", 400, { fields: ["note"] });
    await env.DB.prepare("UPDATE pitches SET status = 'declined', note = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'open'")
      .bind(note || null, now(), session.userId, id).run();
    return privateJson({ ok: true });
  }
  // The text goes in as the member wrote it; the moderator edits the draft before publishing.
  const postId = await draftFrom(env, session, { topic: p.topic, title: p.title, text: p.body, authorId: p.user_id, kind: "pitch", id });
  await env.DB.prepare("UPDATE pitches SET status = 'drafted', post_id = ?, resolved_at = ?, resolved_by = ? WHERE id = ?").bind(postId, now(), session.userId, id).run();
  return privateJson({ ok: true, post_id: postId }, 201);
}

// POST /api/mod/reports/<id>/draft and /api/mod/outside/<id>/draft : a report that is really a submission
export async function draftFromReport(request, env, session, id, outside) {
  const stop = modGuard(request, env, session, true);
  if (stop) return stop;
  const r = outside
    ? await env.DB.prepare("SELECT id, details AS text, NULL AS user_id FROM outside_reports WHERE id = ?").bind(id).first()
    : await env.DB.prepare("SELECT id, details AS text, reporter_id AS user_id FROM reports WHERE id = ?").bind(id).first();
  if (!r) return bad("not_found", 404);
  if (!r.text || !r.text.trim()) return bad("nothing_to_draft", 409);
  // A signed-in reporter submitted the text, so they can be named; outside reports start as site posts.
  const postId = await draftFrom(env, session, { topic: "Guide", title: "Draft from a report", text: r.text.trim(), authorId: r.user_id || null, kind: outside ? "outside_report" : "report", id });
  return privateJson({ ok: true, post_id: postId }, 201);
}

// The pitcher's view, for their account page.
export async function myPitches(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.status, p.note, p.created_at, p.resolved_at, po.slug AS post_slug, po.published_at AS post_published
       FROM pitches p LEFT JOIN posts po ON po.id = p.post_id WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 50`
  ).bind(userId).all();
  return results.map((x) => ({ id: x.id, title: x.title, status: x.status === "drafted" && x.post_published ? "published" : x.status, note: x.note,
    created_at: x.created_at, resolved_at: x.resolved_at, post_slug: x.post_published ? x.post_slug : null }));
}
