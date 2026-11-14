// Reports from people who aren't signed in (no GitHub account needed), behind Cloudflare
// Turnstile, the bot check.
//
// Rules encoded here:
//   - Anyone can flag something: a category, the page's address, their reasons, and an
//     optional reply-to address.
//   - The reply-to address is stored privately, shown only to moderators while the case is
//     open, and deleted the moment the case is closed. It is never shown on the site.
//   - No IP address or other identifier is stored.
//   - The report lands in the same moderation queue. A removal still needs a ground and
//     written reasons (the statement of reasons), exactly as for signed-in reports.

import { privateJson, isSameOrigin, siteOrigin } from "./http.js";
import { isModerator } from "./auth.js";
import { REPORT_CATEGORIES } from "./community.js";

// The widget's public key (not a secret; it is in the page for every visitor).
const DEFAULT_SITE_KEY = "0x4AAAAAAGAW9x8kUg6lsdE4"; // widget "Brainchild report form", for brainchild.nexus
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_PER_HOUR = 40; // across everyone; a flood beyond this is refused rather than stored

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
function nowText() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function siteKey(env) { return (typeof env.TURNSTILE_SITE_KEY === "string" && env.TURNSTILE_SITE_KEY.trim()) || DEFAULT_SITE_KEY; }
function secret(env) { return typeof env.TURNSTILE_SECRET === "string" ? env.TURNSTILE_SECRET.trim() : ""; }
function available(env, url) { return !!secret(env) && url.origin === siteOrigin(env); }
function clean(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s.length <= max ? s : null;
}

// GET /api/report-form : what the page needs to show the bot check
export function reportForm(env, url) {
  return privateJson({ available: available(env, url), site_key: available(env, url) ? siteKey(env) : null, categories: REPORT_CATEGORIES });
}

// Only pages of this site (or a game's address) can be reported through this form.
function reportedUrl(raw, env) {
  const s = clean(raw, 300);
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const site = new URL(siteOrigin(env)).hostname;
  const ok = u.hostname === site || u.hostname === "www." + site || u.hostname === "brainwave.nexus" || u.hostname.endsWith(".brainwave.nexus");
  return ok ? u : null;
}
function projectIdFrom(u) {
  if (u.hostname.endsWith(".brainwave.nexus")) return u.hostname.slice(0, -".brainwave.nexus".length);
  if (/^\/(project|adopt|license|edit)(\.html)?$/.test(u.pathname)) return u.searchParams.get("id");
  return null;
}

async function verify(env, token, request) {
  const body = new URLSearchParams({ secret: secret(env), response: token });
  try {
    const res = await fetch(env.TURNSTILE_VERIFY_URL || VERIFY_URL, { method: "POST", body });
    const data = await res.json();
    // The check must have been solved on this site, not borrowed from another one.
    const host = new URL(request.url).hostname;
    const extra = typeof env.TURNSTILE_TEST_HOSTNAME === "string" ? env.TURNSTILE_TEST_HOSTNAME : null; // local tests only; never set on the live site
    return !!data && data.success === true && (data.hostname === host || (!!extra && data.hostname === extra));
  } catch { return false; }
}

// POST /api/outside-reports  { category, url, details, reply_to, token }
export async function postOutsideReport(request, env, url) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!available(env, url)) return bad("report_form_unavailable", 503);
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return bad("bad_request");
  let body;
  try { const raw = await request.text(); if (raw.length > 20000) return bad("bad_request"); body = JSON.parse(raw); } catch { return bad("bad_request"); }
  if (!body || typeof body !== "object") return bad("bad_request");

  const errors = [];
  const category = REPORT_CATEGORIES.includes(body.category) ? body.category : null;
  if (!category) errors.push("category");
  const target = reportedUrl(body.url, env);
  if (!target) errors.push("url");
  const details = clean(body.details, 2000);
  if (!details || details.length < 10) errors.push("details");
  let replyTo = null;
  if (body.reply_to !== undefined && body.reply_to !== null && body.reply_to !== "") {
    replyTo = clean(body.reply_to, 200);
    if (!replyTo || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo)) { errors.push("reply_to"); replyTo = null; }
  }
  if (errors.length) return bad("invalid_fields", 400, { fields: errors });
  if (typeof body.token !== "string" || !body.token || body.token.length > 4000) return bad("bot_check_failed", 403);
  if (!(await verify(env, body.token, request))) return bad("bot_check_failed", 403);

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM outside_reports WHERE created_at > datetime('now', '-1 hour')").first();
  if (recent.n >= MAX_PER_HOUR) return bad("slow_down", 429);
  let projectId = projectIdFrom(target);
  if (projectId && !/^[a-z0-9-]{1,80}$/.test(projectId)) projectId = null;
  if (projectId && !(await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?").bind(projectId).first())) projectId = null;
  const href = target.href.slice(0, 300);
  // The same page reported again for the same reason while a report is open adds nothing new.
  const dupe = await env.DB.prepare("SELECT id FROM outside_reports WHERE url = ? AND category = ? AND status = 'open'").bind(href, category).first();
  if (dupe) return privateJson({ ok: true });
  await env.DB.prepare(
    "INSERT INTO outside_reports (category, url, project_id, details, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(category, href, projectId, details, replyTo, nowText()).run();
  return privateJson({ ok: true }, 201);
}

// For the moderation queue (moderators only; the caller has already checked).
export async function listOutside(env, closed) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.category, o.url, o.project_id, o.details, o.reply_to, o.status, o.created_at, o.resolved_at, o.resolution_note,
            p.title AS project_title, p.hidden_at AS project_hidden, u.handle AS project_owner
       FROM outside_reports o LEFT JOIN projects p ON p.id = o.project_id LEFT JOIN users u ON u.id = p.owner_id
      WHERE o.status ${closed ? "<> 'open'" : "= 'open'"} ORDER BY o.created_at ${closed ? "DESC" : "ASC"} LIMIT 200`
  ).all();
  return results;
}

// POST /api/mod/outside/<id>/resolve  { decision: "remove" | "handled" | "dismiss", ground, reasons }
export async function resolveOutside(request, env, session, id) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!isModerator(env, session)) return bad("not_moderator", 403);
  let body;
  try { body = JSON.parse(await request.text()); } catch { return bad("bad_request"); }
  if (!body || typeof body !== "object") return bad("bad_request");
  const report = await env.DB.prepare(
    "SELECT o.*, p.owner_id AS project_owner, p.hidden_at AS project_hidden FROM outside_reports o LEFT JOIN projects p ON p.id = o.project_id WHERE o.id = ?"
  ).bind(id).first();
  if (!report) return bad("not_found", 404);
  if (report.status !== "open") return bad("already_resolved", 409);
  const reasons = clean(body.reasons === undefined || body.reasons === null ? "" : body.reasons, 2000);
  if (reasons === null) return bad("invalid_fields", 400, { fields: ["reasons"] });
  const now = nowText();
  // Closing the case deletes the reply-to address, whatever the decision.
  const close = (status, actionId) => env.DB.prepare(
    "UPDATE outside_reports SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, action_id = ?, reply_to = NULL WHERE id = ? AND status = 'open'"
  ).bind(status, now, session.userId, reasons || null, actionId, id);

  if (body.decision === "dismiss" || body.decision === "handled") {
    await close(body.decision === "dismiss" ? "dismissed" : "handled", null).run();
    return privateJson({ ok: true, status: body.decision === "dismiss" ? "dismissed" : "handled" });
  }
  if (body.decision !== "remove") return bad("invalid_fields", 400, { fields: ["decision"] });
  // Removing through this form means removing the project the address points to.
  if (!report.project_id || report.project_owner === undefined) return bad("no_project_to_remove", 409);
  const ground = body.ground === "illegal" ? "illegal" : body.ground === "terms" ? "terms" : null;
  if (!ground) return bad("invalid_fields", 400, { fields: ["ground"] });
  if (reasons.length < 10) return bad("invalid_fields", 400, { fields: ["reasons"] });
  const action = await env.DB.prepare(
    `INSERT INTO moderation_actions (target_type, project_id, comment_id, affected_user_id, action, ground, category, reasons, automated, moderator_id, report_id, created_at)
     VALUES ('project', ?, NULL, ?, 'remove', ?, ?, ?, 0, ?, NULL, ?)`
  ).bind(report.project_id, report.project_owner, ground, report.category, reasons, session.userId, now).run();
  await env.DB.batch([
    env.DB.prepare("UPDATE projects SET hidden_at = COALESCE(hidden_at, ?) WHERE id = ?").bind(now, report.project_id),
    close("actioned", action.meta.last_row_id),
    // Any other open report about the same project is settled by this decision too.
    env.DB.prepare("UPDATE outside_reports SET status = 'actioned', resolved_at = ?, resolved_by = ?, action_id = ?, reply_to = NULL WHERE status = 'open' AND project_id = ?")
      .bind(now, session.userId, action.meta.last_row_id, report.project_id),
    env.DB.prepare("UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ?, action_id = ? WHERE status = 'open' AND project_id = ? AND comment_id IS NULL")
      .bind(now, session.userId, action.meta.last_row_id, report.project_id)
  ]);
  const origin = new URL(request.url).origin;
  await Promise.all(["/api/projects", "/api/projects/" + report.project_id, "/api/projects/" + report.project_id + "/license"]
    .map((p) => caches.default.delete(origin + p).catch(() => false)));
  return privateJson({ ok: true, status: "actioned", action_id: action.meta.last_row_id });
}
