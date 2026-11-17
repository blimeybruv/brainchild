// Merging two accounts that both belong to one person, by a moderator.
//
// When someone links a second sign-in that already has an account of its own, the two are joined
// automatically only if that account was never used (auth.js). Otherwise the person asks a
// moderator (through the contact page), and the moderator uses this tool.
//
// Rules:
//   - Moderators only. A reason is required and every merge is recorded in account_merges.
//   - Everything the folded-in account did moves to the kept account: projects, lineage and credit,
//     license records, comments, reports, votes, Relay activity, badges, builds, screenshots and
//     moderation records. Credit is never removed; it changes account, not person.
//   - The two accounts can't both have a sign-in from the same site (one GitHub, one GitLab at most).
//   - Things that can exist only once per person are kept from the account that stays: a vote in the
//     same month, a like on the same comment, a claim on the same task. A merge that would give one
//     person two entries, or two rankings, in the same Relay round is refused.

import { privateJson, isSameOrigin } from "./http.js";
import { isModerator, ACTIVITY } from "./auth.js";

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
function now() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
const HANDLE = /^[A-Za-z0-9~_.-]{1,100}$/;

async function account(env, handle) {
  if (typeof handle !== "string" || !HANDLE.test(handle.replace(/^@/, ""))) return null;
  const u = await env.DB.prepare("SELECT id, handle, created_at, github_id FROM users WHERE handle = ? COLLATE NOCASE").bind(handle.replace(/^@/, "")).first();
  if (!u) return null;
  const { results: ids } = await env.DB.prepare("SELECT provider, handle, linked_at FROM identities WHERE user_id = ? ORDER BY provider").bind(u.id).all();
  const counts = {};
  for (const [t, c] of ACTIVITY) {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} = ?`).bind(u.id).first();
    if (r.n) counts[t + "." + c] = r.n;
  }
  return { id: u.id, handle: u.handle, created_at: u.created_at, github_id: u.github_id, identities: ids, activity: counts };
}

// What stands in the way of merging `from` into `into`.
async function conflicts(env, from, into) {
  const out = [];
  if (from.id === into.id) out.push("same_account");
  const shared = from.identities.filter((a) => into.identities.some((b) => b.provider === a.provider)).map((a) => a.provider);
  if (shared.length) out.push("both_have_" + shared.join("_and_"));
  const twoEntries = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM relay_entries a JOIN relay_entries b ON a.round_id = b.round_id WHERE a.user_id = ? AND b.user_id = ?"
  ).bind(from.id, into.id).first();
  if (twoEntries.n) out.push("both_entered_the_same_relay_round");
  const twoRankings = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM (SELECT DISTINCT a.round_id FROM relay_votes a JOIN relay_votes b ON a.round_id = b.round_id WHERE a.voter_id = ? AND b.voter_id = ?)"
  ).bind(from.id, into.id).first();
  if (twoRankings.n) out.push("both_ranked_in_the_same_relay_round");
  return out;
}

function guard(request, env, session, write) {
  if (write && !isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!isModerator(env, session)) return bad("not_moderator", 403);
  return null;
}

// GET /api/mod/merge?from=<handle>&into=<handle> : what a merge would do
export async function mergePreview(request, env, session, url) {
  const stop = guard(request, env, session, false);
  if (stop) return stop;
  const from = await account(env, url.searchParams.get("from") || ""), into = await account(env, url.searchParams.get("into") || "");
  if (!from || !into) return bad("not_found", 404, { missing: !from ? "from" : "into" });
  const blocked = await conflicts(env, from, into);
  const { results: recent } = await env.DB.prepare(
    `SELECT m.from_handle, u.handle AS into_handle, mu.handle AS moderator, m.reason, m.merged_at
       FROM account_merges m LEFT JOIN users u ON u.id = m.into_user_id LEFT JOIN users mu ON mu.id = m.moderator_id ORDER BY m.id DESC LIMIT 20`
  ).all();
  const strip = (a) => ({ handle: a.handle, created_at: a.created_at, identities: a.identities, activity: a.activity });
  return privateJson({ from: strip(from), into: strip(into), conflicts: blocked, can_merge: !blocked.length, recent });
}

// POST /api/mod/merge  { from, into, reason }
export async function mergeAccounts(request, env, session) {
  const stop = guard(request, env, session, true);
  if (stop) return stop;
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  const reason = body && typeof body.reason === "string" ? body.reason.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  if (!body || reason.length < 10 || reason.length > 500) return bad("invalid_fields", 400, { fields: ["reason"] });
  const from = await account(env, body.from), into = await account(env, body.into);
  if (!from || !into) return bad("not_found", 404, { missing: !from ? "from" : "into" });
  const blocked = await conflicts(env, from, into);
  if (blocked.length) return bad("cannot_merge", 409, { conflicts: blocked });

  const F = from.id, I = into.id;
  const steps = [
    // Once-per-person rows: the kept account's copy wins, the duplicate from the other is dropped.
    env.DB.prepare("DELETE FROM votes WHERE user_id = ?1 AND month IN (SELECT month FROM votes WHERE user_id = ?2)").bind(F, I),
    env.DB.prepare("DELETE FROM comment_likes WHERE user_id = ?1 AND comment_id IN (SELECT comment_id FROM comment_likes WHERE user_id = ?2)").bind(F, I),
    env.DB.prepare("DELETE FROM relay_claims WHERE user_id = ?1 AND task_id IN (SELECT task_id FROM relay_claims WHERE user_id = ?2)").bind(F, I)
  ];
  for (const [t, c] of ACTIVITY) steps.push(env.DB.prepare(`UPDATE ${t} SET ${c} = ?1 WHERE ${c} = ?2`).bind(I, F));
  steps.push(
    env.DB.prepare("UPDATE identities SET user_id = ?1 WHERE user_id = ?2").bind(I, F),
    // The GitHub id moves with the GitHub sign-in (it decides who is a moderator).
    env.DB.prepare("UPDATE users SET github_id = NULL WHERE id = ?").bind(F),
    env.DB.prepare("UPDATE users SET github_id = COALESCE(github_id, ?1) WHERE id = ?2").bind(from.github_id, I),
    // A screenshot approval on either account counts for the merged one.
    env.DB.prepare("UPDATE users SET screenshots_trusted_at = COALESCE(screenshots_trusted_at, (SELECT screenshots_trusted_at FROM users WHERE id = ?1)) WHERE id = ?2").bind(F, I),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(F),
    env.DB.prepare("INSERT INTO account_merges (from_user_id, from_handle, into_user_id, moderator_id, reason, moved, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(F, from.handle, I, session.userId, reason, JSON.stringify(from.activity), now()),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(F)
  );
  await env.DB.batch(steps); // all or nothing
  const origin = new URL(request.url).origin;
  await caches.default.delete(origin + "/api/projects").catch(() => false);
  return privateJson({ ok: true, into: into.handle, moved: from.activity });
}
