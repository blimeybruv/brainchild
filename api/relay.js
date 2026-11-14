// Relay rounds: each month, maintainers enter a project, rank each other's, and everyone
// helps the winner. The rules are the owner's (HANDOFF.md, "Relay rules").
//
// The month's timetable (all in UTC):
//   days 1-5   Entry. Each person nominates one project they maintain.
//   days 6-7   Vote. Each entrant ranks three other projects (3, 2 and 1 points).
//   day 8      Result. The highest total wins; ties go to more first places, then earlier entry.
//   to month end   Contribute (part B). Then a week of review and the recap (part C).
//
// Rules encoded in this file:
//   - A round needs at least 4 entries. With fewer it doesn't run, and the entries are carried
//     into next month's round.
//   - An entry must be a project the person maintains, listed here with a verified repo that
//     isn't archived (so it can take pull requests). GitHub is asked at the moment of entry.
//   - Only entrants vote, never for their own project, and votes stay private until voting closes.
//   - There is no timer running anywhere: the round moves to its next stage the first time
//     someone looks at it after the stage's date has passed.

import { privateJson, isSameOrigin } from "./http.js";
import { requireRepoAdmin } from "./github.js";

export const MIN_ENTRIES = 4;
const ENTRY_LAST_DAY = 5;
const VOTE_LAST_DAY = 7;

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (raw.length > 10000) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

// "Now", which tests can set so a whole month can be walked through in seconds.
export function relayNow(env) {
  const t = typeof env.RELAY_NOW === "string" && env.RELAY_NOW ? new Date(env.RELAY_NOW) : new Date();
  return Number.isNaN(t.getTime()) ? new Date() : t;
}
function text(d) { return d.toISOString().replace("T", " ").slice(0, 19); }
function monthOf(d) { return d.toISOString().slice(0, 7); }

// The dates of a round, from its month ("2026-12").
export function calendar(month) {
  const [y, m] = month.split("-").map(Number);
  const day = (n) => new Date(Date.UTC(y, m - 1, n)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const reviewEnds = new Date(Date.UTC(y, m, 7)).toISOString().slice(0, 10);
  return { starts: day(1), entry_closes: day(ENTRY_LAST_DAY), vote_closes: day(VOTE_LAST_DAY), result: day(VOTE_LAST_DAY + 1), tasks_due: day(VOTE_LAST_DAY + 3), ends: last, review_ends: reviewEnds };
}

// Points for every entry in a round: 3, 2 and 1 for ranks 1, 2 and 3.
export async function tally(env, roundId) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.created_at,
            COALESCE(SUM(CASE v.rank WHEN 1 THEN 3 WHEN 2 THEN 2 WHEN 3 THEN 1 END), 0) AS points,
            COALESCE(SUM(v.rank = 1), 0) AS firsts
       FROM relay_entries e LEFT JOIN relay_votes v ON v.entry_id = e.id AND v.round_id = e.round_id
      WHERE e.round_id = ? GROUP BY e.id
      ORDER BY points DESC, firsts DESC, e.created_at ASC, e.id ASC`
  ).bind(roundId).all();
  return results;
}

// Move the round on if a stage's date has passed. Each step only happens once, whoever looks first.
export async function advance(env) {
  const now = relayNow(env), month = monthOf(now), day = now.getUTCDate(), stamp = text(now);
  let round = await env.DB.prepare("SELECT * FROM relay_rounds WHERE month = ?").bind(month).first();
  if (!round) {
    // A new month: open its round, and bring in the entries of a round that didn't run.
    await env.DB.prepare("INSERT OR IGNORE INTO relay_rounds (month, status, created_at) VALUES (?, 'entry', ?)").bind(month, stamp).run();
    round = await env.DB.prepare("SELECT * FROM relay_rounds WHERE month = ?").bind(month).first();
    const prev = await env.DB.prepare("SELECT id FROM relay_rounds WHERE id < ? AND status = 'not_run' AND carried = 0 ORDER BY id DESC LIMIT 1").bind(round.id).first();
    if (prev) {
      const claim = await env.DB.prepare("UPDATE relay_rounds SET carried = 1 WHERE id = ? AND carried = 0").bind(prev.id).run();
      if (claim.meta && claim.meta.changes === 1) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO relay_entries (round_id, project_id, user_id, pitch, created_at, carried_from)
           SELECT ?, e.project_id, e.user_id, e.pitch, e.created_at, e.round_id
             FROM relay_entries e JOIN projects p ON p.id = e.project_id
            WHERE e.round_id = ? AND p.hidden_at IS NULL AND p.owner_id = e.user_id`
        ).bind(round.id, prev.id).run();
      }
    }
  }
  if (round.status === "entry" && day > ENTRY_LAST_DAY) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM relay_entries WHERE round_id = ?").bind(round.id).first();
    const next = n.n >= MIN_ENTRIES ? "voting" : "not_run";
    await env.DB.prepare("UPDATE relay_rounds SET status = ? WHERE id = ? AND status = 'entry'").bind(next, round.id).run();
    round = await env.DB.prepare("SELECT * FROM relay_rounds WHERE id = ?").bind(round.id).first();
  }
  if (round.status === "voting" && day > VOTE_LAST_DAY) {
    const ranking = await tally(env, round.id);
    await env.DB.prepare("UPDATE relay_rounds SET status = 'running', winner_entry_id = ?, decided_at = ? WHERE id = ? AND status = 'voting'")
      .bind(ranking[0].id, stamp, round.id).run();
    round = await env.DB.prepare("SELECT * FROM relay_rounds WHERE id = ?").bind(round.id).first();
  }
  return round;
}

// The rounds that actually ran are numbered 1, 2, 3 ... in order.
async function roundNumber(env, round) {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM relay_rounds WHERE id <= ? AND (status <> 'not_run' OR id = ?)").bind(round.id, round.id).first();
  return n.n;
}

// GET /api/relay : the current round as this visitor sees it
export async function relayState(env, session) {
  const round = await advance(env);
  const { results: entries } = await env.DB.prepare(
    `SELECT e.id, e.project_id, e.user_id, e.pitch, e.created_at, e.carried_from, p.title, p.kind, p.genre, p.base_game, p.tone, u.handle AS owner,
            (SELECT s.id FROM screenshots s WHERE s.project_id = p.id ORDER BY s.id LIMIT 1) AS shot
       FROM relay_entries e JOIN projects p ON p.id = e.project_id JOIN users u ON u.id = e.user_id
      WHERE e.round_id = ? AND p.hidden_at IS NULL ORDER BY e.created_at, e.id`
  ).bind(round.id).all();
  // Points are shown only once voting has closed.
  const decided = round.status === "running" || round.status === "review" || round.status === "closed";
  const scores = decided ? new Map((await tally(env, round.id)).map((t) => [t.id, t])) : new Map();
  const mine = session ? entries.find((e) => e.user_id === session.userId) : null;
  const out = {
    round: { number: await roundNumber(env, round), month: round.month, status: round.status, ...calendar(round.month), min_entries: MIN_ENTRIES },
    entries: entries.map((e) => ({
      id: e.id, project_id: e.project_id, title: e.title, kind: e.kind, genre: e.genre, base_game: e.base_game, tone: e.tone, shot: e.shot,
      owner: e.owner, pitch: e.pitch, carried_over: !!e.carried_from, mine: !!mine && e.id === mine.id,
      points: decided ? (scores.get(e.id) || { points: 0 }).points : null,
      first_places: decided ? (scores.get(e.id) || { firsts: 0 }).firsts : null,
      winner: decided && e.id === round.winner_entry_id
    })),
    me: { signed_in: !!session, entry_id: mine ? mine.id : null, projects: [], ranks: {} }
  };
  if (decided) out.round.ranked_by = (await env.DB.prepare("SELECT COUNT(DISTINCT voter_id) AS n FROM relay_votes WHERE round_id = ?").bind(round.id).first()).n;
  if (session) {
    // The projects this person could nominate: ones they maintain, with a verified repo.
    const { results: projects } = await env.DB.prepare(
      "SELECT id, title FROM projects WHERE owner_id = ? AND repo_full_name IS NOT NULL AND hidden_at IS NULL ORDER BY title"
    ).bind(session.userId).all();
    out.me.projects = projects;
    const { results: ranks } = await env.DB.prepare("SELECT entry_id, rank FROM relay_votes WHERE round_id = ? AND voter_id = ?").bind(round.id, session.userId).all();
    for (const r of ranks) out.me.ranks[r.entry_id] = r.rank;
  }
  return privateJson(out);
}

// POST /api/relay/enter  { project_id, pitch }
export async function enterRelay(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const pitch = typeof body.pitch === "string" ? body.pitch.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  if (pitch.length < 10 || pitch.length > 300) return bad("invalid_fields", 400, { fields: ["pitch"] });
  const id = typeof body.project_id === "string" ? body.project_id : "";
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return bad("invalid_fields", 400, { fields: ["project_id"] });
  const round = await advance(env);
  if (round.status !== "entry") return bad("entry_closed", 409);
  const p = await env.DB.prepare("SELECT id, owner_id, repo_full_name FROM projects WHERE id = ? AND hidden_at IS NULL").bind(id).first();
  if (!p) return bad("not_found", 404);
  if (p.owner_id !== session.userId) return bad("not_maintainer", 403);
  if (!p.repo_full_name) return bad("listing_not_verified", 409);
  // GitHub is asked now: the entrant must still control the repo, and it must be able to take pull requests.
  const [owner, name] = p.repo_full_name.split("/");
  const own = await requireRepoAdmin(env, session, owner, name);
  if (own.response) return own.response;
  if (own.repo.archived) return bad("repo_archived", 409);
  try {
    const r = await env.DB.prepare("INSERT INTO relay_entries (round_id, project_id, user_id, pitch, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(round.id, id, session.userId, pitch, text(relayNow(env))).run();
    return privateJson({ ok: true, entry_id: r.meta.last_row_id }, 201);
  } catch {
    return bad("already_entered", 409); // one project per person per round
  }
}

// POST /api/relay/withdraw : take your entry back while entry is still open
export async function withdrawRelay(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const round = await advance(env);
  if (round.status !== "entry") return bad("entry_closed", 409);
  const r = await env.DB.prepare("DELETE FROM relay_entries WHERE round_id = ? AND user_id = ?").bind(round.id, session.userId).run();
  if (!r.meta || r.meta.changes < 1) return bad("not_found", 404);
  return privateJson({ ok: true });
}

// POST /api/relay/rank  { ranks: [entry id for 1st, entry id for 2nd, entry id for 3rd] }
export async function rankRelay(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const picks = Array.isArray(body.ranks) ? body.ranks : null;
  if (!picks || picks.length !== 3 || !picks.every((x) => Number.isSafeInteger(x)) || new Set(picks).size !== 3) {
    return bad("invalid_fields", 400, { fields: ["ranks"] });
  }
  const round = await advance(env);
  if (round.status !== "voting") return bad("voting_closed", 409);
  const { results: entries } = await env.DB.prepare("SELECT id, user_id FROM relay_entries WHERE round_id = ?").bind(round.id).all();
  const mine = entries.find((e) => e.user_id === session.userId);
  if (!mine) return bad("not_an_entrant", 403); // only entrants vote
  for (const id of picks) {
    const e = entries.find((x) => x.id === id);
    if (!e) return bad("invalid_fields", 400, { fields: ["ranks"] });
    if (e.id === mine.id) return bad("own_project", 409); // never your own
  }
  // Replacing the three ranks together keeps a person's vote whole.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM relay_votes WHERE round_id = ? AND voter_id = ?").bind(round.id, session.userId),
    ...picks.map((id, i) => env.DB.prepare("INSERT INTO relay_votes (round_id, voter_id, entry_id, rank) VALUES (?, ?, ?, ?)").bind(round.id, session.userId, id, i + 1))
  ]);
  return privateJson({ ok: true });
}
