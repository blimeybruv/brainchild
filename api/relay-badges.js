// Relay rounds, the end of a round: badges, the recap, and the public user page they show on.
//
// Rules encoded in this file (HANDOFF.md, "Relay rules"):
//   - The winning maintainer awards "Most helpful contributor" and, if they wish, "Best wildcard",
//     during the review week. They can change or take back a pick until review ends.
//   - Nobody awards a badge to themself, and a badge only goes to a pull request that counts.
//   - If the maintainer awarded none by the time the round closes, a moderator may award them.
//   - Badges appear on the round's page at once, and on user pages and in discussions once the
//     round has closed and the picks are final.

import { json, privateJson, isSameOrigin } from "./http.js";
import { isModerator } from "./auth.js";
import { bad, readJson, text, relayNow, roundFor } from "./relay.js";

export const BADGES = { helpful: "Most helpful contributor", wildcard: "Best wildcard" };
const NUMBER = "(SELECT COUNT(*) FROM relay_rounds x WHERE x.id <= r.id AND x.status <> 'not_run')";
const COUNTS = "(c.flag_outcome IS NULL OR c.flag_outcome <> 'upheld')";

// The badges of one round, for its page.
export async function roundBadges(env, roundId) {
  const { results } = await env.DB.prepare(
    "SELECT b.kind, b.contribution_id, b.by_moderator, u.handle FROM relay_badges b JOIN users u ON u.id = b.user_id WHERE b.round_id = ? ORDER BY b.kind"
  ).bind(roundId).all();
  return results.map((b) => ({ kind: b.kind, label: BADGES[b.kind], user: b.handle, contribution_id: b.contribution_id, by_moderator: !!b.by_moderator }));
}

// May this person award badges for this round right now?
export async function canAward(env, session, round, winnerUserId) {
  if (!session) return false;
  if (round.status === "review") return session.userId === winnerUserId;
  if (round.status !== "closed" || !isModerator(env, session)) return false;
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM relay_badges WHERE round_id = ? AND by_moderator = 0").bind(round.id).first();
  return n.n === 0; // only when the maintainer awarded none
}

// POST /api/relay/badges  { month, kind: "helpful" | "wildcard", contribution_id (null takes the badge back) }
export async function awardBadge(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const kind = body.kind === "helpful" || body.kind === "wildcard" ? body.kind : null;
  const cid = body.contribution_id === null ? null : Number.isSafeInteger(body.contribution_id) ? body.contribution_id : NaN;
  if (!kind || Number.isNaN(cid)) return bad("invalid_fields", 400, { fields: [kind ? "contribution_id" : "kind"] });
  const round = await roundFor(env, typeof body.month === "string" ? body.month : null);
  if (!round || !round.winner_entry_id) return bad("not_found", 404);
  const w = await env.DB.prepare("SELECT user_id FROM relay_entries WHERE id = ?").bind(round.winner_entry_id).first();
  if (round.status !== "review" && round.status !== "closed") return bad("awards_not_open", 409);
  if (!(await canAward(env, session, round, w.user_id))) {
    if (round.status === "review") return bad("not_maintainer", 403);
    return isModerator(env, session) || session.userId === w.user_id ? bad("awards_closed", 409) : bad("not_moderator", 403);
  }
  const review = round.status === "review";
  if (cid === null) {
    if (!review) return bad("awards_closed", 409);
    await env.DB.prepare("DELETE FROM relay_badges WHERE round_id = ? AND kind = ?").bind(round.id, kind).run();
    return privateJson({ ok: true });
  }
  const c = await env.DB.prepare("SELECT id, user_id, task_id, flagged_at, flag_outcome FROM relay_contributions WHERE id = ? AND round_id = ?").bind(cid, round.id).first();
  if (!c) return bad("not_found", 404);
  if (c.user_id === session.userId || c.user_id === w.user_id) return bad("own_contribution", 409);
  if (c.flag_outcome === "upheld" || (c.flagged_at && !c.flag_outcome)) return bad("not_counting", 409);
  if (kind === "wildcard" && c.task_id !== null) return bad("not_a_wildcard", 409);
  const now = text(relayNow(env));
  if (review) {
    await env.DB.prepare(
      `INSERT INTO relay_badges (round_id, kind, user_id, contribution_id, awarded_by, by_moderator, awarded_at) VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (round_id, kind) DO UPDATE SET user_id = excluded.user_id, contribution_id = excluded.contribution_id, awarded_by = excluded.awarded_by, awarded_at = excluded.awarded_at`
    ).bind(round.id, kind, c.user_id, c.id, session.userId, now).run();
  } else {
    const r = await env.DB.prepare(
      "INSERT OR IGNORE INTO relay_badges (round_id, kind, user_id, contribution_id, awarded_by, by_moderator, awarded_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
    ).bind(round.id, kind, c.user_id, c.id, session.userId, now).run();
    if (!r.meta || r.meta.changes < 1) return bad("already_awarded", 409);
  }
  return privateJson({ ok: true });
}

// Final badges for everyone who commented on a project: a map of user id to the pills shown by their name.
export async function commentBadges(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT b.user_id, b.kind, ${NUMBER} AS number
       FROM relay_badges b JOIN relay_rounds r ON r.id = b.round_id
      WHERE r.status = 'closed' AND b.user_id IN (SELECT user_id FROM comments WHERE project_id = ?) ORDER BY r.id`
  ).bind(projectId).all();
  const by = new Map();
  for (const b of results) {
    if (!by.has(b.user_id)) by.set(b.user_id, {});
    const k = by.get(b.user_id);
    (k[b.kind] = k[b.kind] || []).push(b.number);
  }
  const out = new Map();
  for (const [user, kinds] of by) {
    out.set(user, Object.keys(kinds).sort().map((kind) => ({
      label: (kind === "helpful" ? "Most helpful" : "Best wildcard") + " ×" + kinds[kind].length,
      title: BADGES[kind] + " · Relay round " + kinds[kind].join(", ")
    })));
  }
  return out;
}

// GET /api/users/<handle> : a person's public page. Never includes an email address.
export async function userPage(env, handle) {
  if (!/^[A-Za-z0-9~_.-]{1,60}$/.test(handle)) return json({ error: "not_found" }, 404, { "cache-control": "no-store" });
  const u = await env.DB.prepare("SELECT id, handle, avatar_url, created_at FROM users WHERE handle = ? COLLATE NOCASE").bind(handle).first();
  if (!u) return json({ error: "not_found" }, 404, { "cache-control": "no-store" });
  const { results: projects } = await env.DB.prepare(
    "SELECT id, title, kind, genre, base_game FROM projects WHERE owner_id = ? AND hidden_at IS NULL ORDER BY title LIMIT 100"
  ).bind(u.id).all();
  const { results: badges } = await env.DB.prepare(
    `SELECT b.kind, r.month, ${NUMBER} AS number, p.id AS project_id, p.title AS project_title
       FROM relay_badges b JOIN relay_rounds r ON r.id = b.round_id
       JOIN relay_entries e ON e.id = r.winner_entry_id JOIN projects p ON p.id = e.project_id
      WHERE b.user_id = ? AND r.status = 'closed' ORDER BY r.id DESC`
  ).bind(u.id).all();
  const { results: rounds } = await env.DB.prepare(
    `SELECT r.month, ${NUMBER} AS number, p.id AS project_id, p.title AS project_title, COUNT(*) AS pull_requests
       FROM relay_contributions c JOIN relay_rounds r ON r.id = c.round_id
       JOIN relay_entries e ON e.id = r.winner_entry_id JOIN projects p ON p.id = e.project_id
      WHERE c.user_id = ? AND ${COUNTS} GROUP BY r.id ORDER BY r.id DESC LIMIT 50`
  ).bind(u.id).all();
  return json({
    handle: u.handle, avatar_url: u.avatar_url, member_since: u.created_at,
    projects,
    badges: badges.map((b) => ({ kind: b.kind, label: BADGES[b.kind] + " · Relay round " + b.number, month: b.month, project_id: b.project_id, project_title: b.project_title })),
    relay: rounds
  });
}
