// Discussion on project pages, reports, and the moderation queue.
//
// Rules encoded here:
//   - Anyone signed in can comment, mark a comment helpful, and report a project or a comment.
//   - A project's current maintainer can pin comments. Authors can delete their own.
//   - Every report goes to a moderator. A removal always records a statement of reasons
//     (what was removed, why, on what ground, that no automated tool decided it), which the
//     affected person can read and ask to have reviewed (EU DSA notice and action).
//   - Removing a project hides its page; its lineage and license records are kept.

import { privateJson, isSameOrigin } from "./http.js";
import { isModerator } from "./auth.js";
import { listOutside } from "./outside.js";

export const REPORT_CATEGORIES = ["sexual", "rating", "malware", "license", "harass", "spam", "other"];
const MAX_COMMENT = 2000;

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
function clean(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s.length <= max ? s : null;
}
async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (raw.length > 20000) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}
function guard(request, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  return null;
}
async function visibleProject(env, id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return null;
  return env.DB.prepare("SELECT id, title, owner_id FROM projects WHERE id = ? AND hidden_at IS NULL").bind(id).first();
}
function nowText() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// ---------- comments ----------

export async function listComments(env, session, projectId) {
  const project = await visibleProject(env, projectId);
  if (!project) return bad("not_found", 404);
  const { results: rows } = await env.DB.prepare(
    `SELECT c.id, c.parent_id, c.body, c.pinned, c.created_at, c.removed_at, c.user_id, u.handle, u.avatar_url,
            (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) AS likes
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.project_id = ? ORDER BY c.created_at, c.id LIMIT 1000`
  ).bind(projectId).all();
  const { results: creators } = await env.DB.prepare("SELECT user_id FROM lineage WHERE project_id = ? AND role = 'creator'").bind(projectId).all();
  const made = new Set(creators.map((x) => x.user_id));
  const liked = new Set();
  if (session) {
    const { results } = await env.DB.prepare(
      "SELECT l.comment_id FROM comment_likes l JOIN comments c ON c.id = l.comment_id WHERE c.project_id = ? AND l.user_id = ?"
    ).bind(projectId, session.userId).all();
    for (const x of results) liked.add(x.comment_id);
  }
  const role = (userId) => {
    const owner = userId === project.owner_id, creator = made.has(userId);
    return owner && creator ? "Maker" : creator ? "Original maker" : owner ? "Maintainer" : "";
  };
  const shape = (c) => ({
    id: c.id, user: c.handle, avatar_url: c.avatar_url, role: role(c.user_id), badges: [], // badges come with Relay rounds
    body: c.removed_at ? null : c.body, removed: !!c.removed_at, created_at: c.created_at,
    mine: !!session && c.user_id === session.userId
  });
  const top = [], byId = new Map();
  for (const c of rows) {
    if (c.parent_id) continue;
    const t = { ...shape(c), pinned: !!c.pinned && !c.removed_at, likes: c.likes, liked: liked.has(c.id), replies: [] };
    byId.set(c.id, t);
    top.push(t);
  }
  for (const c of rows) {
    if (!c.parent_id || c.removed_at) continue;
    const t = byId.get(c.parent_id);
    if (t) t.replies.push(shape(c));
  }
  // A removed comment stays only as a placeholder, and only while it still has replies under it.
  const comments = top.filter((t) => !t.removed || t.replies.length);
  const count = comments.reduce((n, t) => n + (t.removed ? 0 : 1) + t.replies.length, 0);
  return privateJson({
    comments, count, signed_in: !!session,
    can_pin: !!session && session.userId === project.owner_id
  });
}

export async function postComment(request, env, session, projectId) {
  const stop = guard(request, session);
  if (stop) return stop;
  const project = await visibleProject(env, projectId);
  if (!project) return bad("not_found", 404);
  const body = await readJson(request);
  const text = body ? clean(body.body, MAX_COMMENT) : null;
  if (!text) return bad("invalid_fields", 400, { fields: ["body"] });
  let parentId = null;
  if (body.parent_id !== undefined && body.parent_id !== null) {
    if (!Number.isSafeInteger(body.parent_id)) return bad("invalid_fields", 400, { fields: ["parent_id"] });
    // Replies go one level deep, under a comment on the same project that is still up.
    const parent = await env.DB.prepare(
      "SELECT id FROM comments WHERE id = ? AND project_id = ? AND parent_id IS NULL AND removed_at IS NULL"
    ).bind(body.parent_id, projectId).first();
    if (!parent) return bad("not_found", 404);
    parentId = parent.id;
  }
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > datetime('now', '-10 minutes')"
  ).bind(session.userId).first();
  if (recent && recent.n >= 10) return bad("slow_down", 429);
  const r = await env.DB.prepare("INSERT INTO comments (project_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(projectId, session.userId, parentId, text, nowText()).run();
  return privateJson({ ok: true, id: r.meta.last_row_id }, 201);
}

async function ownComment(env, id) {
  return env.DB.prepare(
    `SELECT c.id, c.user_id, c.parent_id, c.removed_at, c.project_id, p.owner_id
       FROM comments c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.hidden_at IS NULL`
  ).bind(id).first();
}

// POST /api/comments/<id>/like | pin | delete
export async function commentAction(request, env, session, id, action) {
  const stop = guard(request, session);
  if (stop) return stop;
  const c = await ownComment(env, id);
  if (!c || c.removed_at) return bad("not_found", 404);
  if (action === "like") {
    const had = await env.DB.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?").bind(id, session.userId).run();
    const liked = !(had.meta && had.meta.changes === 1);
    if (liked) await env.DB.prepare("INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)").bind(id, session.userId).run();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?").bind(id).first();
    return privateJson({ ok: true, liked, likes: n.n });
  }
  if (action === "pin") {
    if (session.userId !== c.owner_id) return bad("not_maintainer", 403); // only the current maintainer pins
    if (c.parent_id) return bad("invalid_fields", 400, { fields: ["id"] });
    const body = await readJson(request);
    const pinned = body && body.pinned === true ? 1 : 0;
    await env.DB.prepare("UPDATE comments SET pinned = ? WHERE id = ?").bind(pinned, id).run();
    return privateJson({ ok: true, pinned: !!pinned });
  }
  if (action === "delete") {
    if (session.userId !== c.user_id) return bad("not_yours", 403);
    await env.DB.prepare("UPDATE comments SET removed_at = ?, removed_by = 'author', pinned = 0 WHERE id = ?").bind(nowText(), id).run();
    return privateJson({ ok: true });
  }
  return bad("not_found", 404);
}

// ---------- reports ----------

export async function postReport(request, env, session) {
  const stop = guard(request, session);
  if (stop) return stop;
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const category = REPORT_CATEGORIES.includes(body.category) ? body.category : null;
  const details = clean(body.details === undefined || body.details === null ? "" : body.details, 1000);
  if (!category) return bad("invalid_fields", 400, { fields: ["category"] });
  if (details === null || (category === "other" && !details)) return bad("invalid_fields", 400, { fields: ["details"] });
  let projectId = null, commentId = null;
  if (body.comment_id !== undefined && body.comment_id !== null) {
    if (!Number.isSafeInteger(body.comment_id)) return bad("invalid_fields", 400, { fields: ["comment_id"] });
    const c = await ownComment(env, body.comment_id);
    if (!c || c.removed_at) return bad("not_found", 404);
    commentId = c.id; projectId = c.project_id;
  } else {
    const p = await visibleProject(env, String(body.project_id || ""));
    if (!p) return bad("not_found", 404);
    projectId = p.id;
  }
  // Reporting the same thing twice doesn't create a second report.
  const dupe = await env.DB.prepare(
    "SELECT id FROM reports WHERE reporter_id = ? AND project_id = ? AND comment_id IS ? AND status = 'open'"
  ).bind(session.userId, projectId, commentId).first();
  if (dupe) return privateJson({ ok: true, id: dupe.id });
  const today = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > datetime('now', '-1 day')"
  ).bind(session.userId).first();
  if (today && today.n >= 20) return bad("slow_down", 429);
  const r = await env.DB.prepare(
    "INSERT INTO reports (target_type, project_id, comment_id, category, details, reporter_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(commentId ? "comment" : "project", projectId, commentId, category, details || null, session.userId, nowText()).run();
  return privateJson({ ok: true, id: r.meta.last_row_id }, 201);
}

// ---------- moderation queue (moderators only) ----------

function modGuard(request, env, session, write) {
  if (write && !isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!isModerator(env, session)) return bad("not_moderator", 403);
  return null;
}

export async function modQueue(request, env, session, url) {
  const stop = modGuard(request, env, session, false);
  if (stop) return stop;
  const closed = url.searchParams.get("status") === "closed";
  const { results: reports } = await env.DB.prepare(
    `SELECT r.id, r.target_type, r.project_id, r.comment_id, r.category, r.details, r.status, r.created_at, r.resolved_at, r.resolution_note,
            ru.handle AS reporter, p.title AS project_title, p.hidden_at AS project_hidden, po.handle AS project_owner,
            c.body AS comment_body, c.removed_at AS comment_removed, cu.handle AS comment_author
       FROM reports r
       JOIN users ru ON ru.id = r.reporter_id
       JOIN projects p ON p.id = r.project_id
       LEFT JOIN users po ON po.id = p.owner_id
       LEFT JOIN comments c ON c.id = r.comment_id
       LEFT JOIN users cu ON cu.id = c.user_id
      WHERE r.status ${closed ? "<> 'open'" : "= 'open'"}
      ORDER BY r.created_at ${closed ? "DESC" : "ASC"} LIMIT 200`
  ).all();
  const { results: appeals } = await env.DB.prepare(
    `SELECT a.id, a.target_type, a.project_id, a.comment_id, a.category, a.ground, a.reasons, a.created_at, a.appeal_text, a.appeal_at,
            u.handle AS affected, p.title AS project_title, c.body AS comment_body
       FROM moderation_actions a
       LEFT JOIN users u ON u.id = a.affected_user_id
       LEFT JOIN projects p ON p.id = a.project_id
       LEFT JOIN comments c ON c.id = a.comment_id
      WHERE a.action = 'remove' AND a.appeal_at IS NOT NULL AND a.appeal_outcome IS NULL
      ORDER BY a.appeal_at LIMIT 200`
  ).all();
  // Rating changes made by maintainers, with the old and new values, newest first.
  const { results: ratings } = await env.DB.prepare(
    `SELECT c.project_id, p.title AS project_title, u.handle AS changed_by, c.changed_at, c.rating_old, c.rating_new, c.notes_old, c.notes_new
       FROM project_changes c JOIN projects p ON p.id = c.project_id LEFT JOIN users u ON u.id = c.user_id
      WHERE c.rating_new IS NOT NULL ORDER BY c.id DESC LIMIT 50`
  ).all();
  // Reports from people who aren't signed in arrive in the same queue.
  return privateJson({ reports, outside: await listOutside(env, closed), appeals: closed ? [] : appeals, rating_changes: closed ? [] : ratings });
}

// POST /api/mod/reports/<id>/resolve  { decision: "remove" | "dismiss", ground, reasons }
export async function modResolve(request, env, session, id) {
  const stop = modGuard(request, env, session, true);
  if (stop) return stop;
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const report = await env.DB.prepare(
    `SELECT r.*, c.user_id AS comment_author, p.owner_id AS project_owner
       FROM reports r JOIN projects p ON p.id = r.project_id LEFT JOIN comments c ON c.id = r.comment_id WHERE r.id = ?`
  ).bind(id).first();
  if (!report) return bad("not_found", 404);
  if (report.status !== "open") return bad("already_resolved", 409);
  const now = nowText();
  const reasons = clean(body.reasons === undefined || body.reasons === null ? "" : body.reasons, 2000);
  if (reasons === null) return bad("invalid_fields", 400, { fields: ["reasons"] });

  if (body.decision === "dismiss") {
    await env.DB.prepare("UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ? AND status = 'open'")
      .bind(now, session.userId, reasons || null, id).run();
    return privateJson({ ok: true, status: "dismissed" });
  }
  if (body.decision !== "remove") return bad("invalid_fields", 400, { fields: ["decision"] });
  // A removal is never recorded without its reasons.
  const ground = body.ground === "illegal" ? "illegal" : body.ground === "terms" ? "terms" : null;
  if (!ground) return bad("invalid_fields", 400, { fields: ["ground"] });
  if (reasons.length < 10) return bad("invalid_fields", 400, { fields: ["reasons"] });
  const isComment = report.target_type === "comment";
  const action = await env.DB.prepare(
    `INSERT INTO moderation_actions (target_type, project_id, comment_id, affected_user_id, action, ground, category, reasons, automated, moderator_id, report_id, created_at)
     VALUES (?, ?, ?, ?, 'remove', ?, ?, ?, 0, ?, ?, ?)`
  ).bind(report.target_type, report.project_id, report.comment_id, isComment ? report.comment_author : report.project_owner,
    ground, report.category, reasons, session.userId, id, now).run();
  const actionId = action.meta.last_row_id;
  await env.DB.batch([
    isComment
      ? env.DB.prepare("UPDATE comments SET removed_at = COALESCE(removed_at, ?), removed_by = 'moderator', pinned = 0 WHERE id = ?").bind(now, report.comment_id)
      : env.DB.prepare("UPDATE projects SET hidden_at = COALESCE(hidden_at, ?) WHERE id = ?").bind(now, report.project_id),
    // Every open report about the same thing is closed by this one decision.
    env.DB.prepare(
      "UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ?, action_id = ? WHERE status = 'open' AND project_id = ? AND comment_id IS ?"
    ).bind(now, session.userId, actionId, report.project_id, report.comment_id)
  ]);
  if (!isComment) {
    const origin = new URL(request.url).origin;
    await Promise.all(["/api/projects", "/api/projects/" + report.project_id, "/api/projects/" + report.project_id + "/license"]
      .map((p) => caches.default.delete(origin + p).catch(() => false)));
  }
  return privateJson({ ok: true, status: "actioned", action_id: actionId });
}

// POST /api/mod/actions/<id>/appeal  { decision: "restore" | "uphold", note }
export async function modAppeal(request, env, session, id) {
  const stop = modGuard(request, env, session, true);
  if (stop) return stop;
  const body = await readJson(request);
  const decision = body && (body.decision === "restore" || body.decision === "uphold") ? body.decision : null;
  const note = body ? clean(body.note === undefined || body.note === null ? "" : body.note, 2000) : null;
  if (!decision || note === null) return bad("invalid_fields", 400, { fields: ["decision"] });
  const a = await env.DB.prepare("SELECT * FROM moderation_actions WHERE id = ? AND action = 'remove'").bind(id).first();
  if (!a) return bad("not_found", 404);
  if (!a.appeal_at || a.appeal_outcome) return bad("already_resolved", 409);
  const now = nowText();
  const steps = [env.DB.prepare("UPDATE moderation_actions SET appeal_outcome = ?, appeal_note = ?, appeal_resolved_at = ? WHERE id = ?")
    .bind(decision === "restore" ? "restored" : "upheld", note || null, now, id)];
  if (decision === "restore") {
    steps.push(a.target_type === "comment"
      ? env.DB.prepare("UPDATE comments SET removed_at = NULL, removed_by = NULL WHERE id = ? AND removed_by = 'moderator'").bind(a.comment_id)
      : env.DB.prepare("UPDATE projects SET hidden_at = NULL WHERE id = ?").bind(a.project_id));
  }
  await env.DB.batch(steps);
  if (decision === "restore" && a.target_type === "project") {
    await caches.default.delete(new URL(request.url).origin + "/api/projects").catch(() => false);
  }
  return privateJson({ ok: true, outcome: decision === "restore" ? "restored" : "upheld" });
}

// ---------- notices for the signed-in user ----------

// GET /api/my/notices : decisions about things you posted, and what happened to your reports.
export async function myNotices(env, session) {
  if (!session) return bad("not_signed_in", 401);
  const { results: decisions } = await env.DB.prepare(
    `SELECT a.id, a.target_type, a.project_id, a.category, a.ground, a.reasons, a.automated, a.created_at,
            a.appeal_text, a.appeal_at, a.appeal_outcome, a.appeal_note, p.title AS project_title, c.body AS comment_body
       FROM moderation_actions a LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN comments c ON c.id = a.comment_id
      WHERE a.affected_user_id = ? AND a.action = 'remove' ORDER BY a.created_at DESC LIMIT 100`
  ).bind(session.userId).all();
  const { results: reports } = await env.DB.prepare(
    `SELECT r.id, r.target_type, r.project_id, r.category, r.status, r.created_at, r.resolved_at, p.title AS project_title
       FROM reports r LEFT JOIN projects p ON p.id = r.project_id WHERE r.reporter_id = ? ORDER BY r.created_at DESC LIMIT 100`
  ).bind(session.userId).all();
  for (const d of decisions) d.automated = !!d.automated;
  return privateJson({ decisions, reports });
}

// POST /api/my/notices/<action id>/appeal  { text } : ask for a removal to be looked at again (once).
export async function appealNotice(request, env, session, id) {
  const stop = guard(request, session);
  if (stop) return stop;
  const body = await readJson(request);
  const text = body ? clean(body.text, 2000) : null;
  if (!text || text.length < 10) return bad("invalid_fields", 400, { fields: ["text"] });
  const r = await env.DB.prepare(
    "UPDATE moderation_actions SET appeal_text = ?, appeal_at = ? WHERE id = ? AND affected_user_id = ? AND action = 'remove' AND appeal_at IS NULL"
  ).bind(text, nowText(), id, session.userId).run();
  if (!r.meta || r.meta.changes !== 1) return bad("already_resolved", 409);
  return privateJson({ ok: true });
}
