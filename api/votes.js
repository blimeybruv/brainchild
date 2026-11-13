// The monthly community-project vote on the blog page.
//
// Rules encoded here:
//   - During each calendar month (UTC), people propose and vote on next month's project.
//   - Any project that is up for adoption can be proposed, once per month, with a goal.
//   - One vote per person per month. A vote can be changed or withdrawn until the month ends.
//   - Vote counts are not shown while voting is open, so early votes don't steer later ones.

import { privateJson, isSameOrigin } from "./http.js";

const MAX_PROPOSALS_PER_USER = 3;

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }
async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (raw.length > 5000) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

// The month being voted on (next month) and the day voting closes (last day of this month).
export function votingMonth(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const next = new Date(Date.UTC(y, m + 1, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  return { month: next.toISOString().slice(0, 7), closes: last.toISOString().slice(0, 10) };
}

// GET /api/votes
export async function listVotes(env, session) {
  const { month, closes } = votingMonth();
  const { results } = await env.DB.prepare(
    `SELECT pr.id, pr.project_id, pr.goal, pr.user_id, u.handle AS proposed_by, p.title, p.kind, p.base_game, p.tone,
            (SELECT s.id FROM screenshots s WHERE s.project_id = p.id ORDER BY s.id LIMIT 1) AS shot
       FROM proposals pr JOIN projects p ON p.id = pr.project_id LEFT JOIN users u ON u.id = pr.user_id
      WHERE pr.month = ? AND p.hidden_at IS NULL ORDER BY pr.created_at, pr.id LIMIT 100`
  ).bind(month).all();
  let myVote = null;
  if (session) {
    const v = await env.DB.prepare("SELECT proposal_id FROM votes WHERE user_id = ? AND month = ?").bind(session.userId, month).first();
    myVote = v ? v.proposal_id : null;
  }
  return privateJson({
    month, closes, signed_in: !!session, my_vote: myVote,
    proposals: results.map((r) => ({
      id: r.id, project_id: r.project_id, title: r.title, kind: r.kind, base_game: r.base_game, tone: r.tone, shot: r.shot,
      goal: r.goal, proposed_by: r.proposed_by, mine: !!session && r.user_id === session.userId
    }))
  });
}

// POST /api/votes  { proposal_id }   (proposal_id: null withdraws the vote)
export async function castVote(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const { month } = votingMonth();
  if (body.proposal_id === null) {
    await env.DB.prepare("DELETE FROM votes WHERE user_id = ? AND month = ?").bind(session.userId, month).run();
    return privateJson({ ok: true, my_vote: null });
  }
  if (!Number.isSafeInteger(body.proposal_id)) return bad("invalid_fields", 400, { fields: ["proposal_id"] });
  // Only this month's proposals can be voted for.
  const p = await env.DB.prepare(
    "SELECT pr.id FROM proposals pr JOIN projects p ON p.id = pr.project_id WHERE pr.id = ? AND pr.month = ? AND p.hidden_at IS NULL"
  ).bind(body.proposal_id, month).first();
  if (!p) return bad("not_found", 404);
  // The table's key is (person, month), so a second vote replaces the first.
  await env.DB.prepare(
    `INSERT INTO votes (user_id, month, proposal_id) VALUES (?, ?, ?)
     ON CONFLICT (user_id, month) DO UPDATE SET proposal_id = excluded.proposal_id, created_at = datetime('now')`
  ).bind(session.userId, month, p.id).run();
  return privateJson({ ok: true, my_vote: p.id });
}

// POST /api/proposals  { project_id, goal }
export async function propose(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const goal = typeof body.goal === "string" ? body.goal.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  if (goal.length < 10 || goal.length > 300) return bad("invalid_fields", 400, { fields: ["goal"] });
  const id = typeof body.project_id === "string" ? body.project_id : "";
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return bad("invalid_fields", 400, { fields: ["project_id"] });
  const project = await env.DB.prepare("SELECT id, status FROM projects WHERE id = ? AND hidden_at IS NULL").bind(id).first();
  if (!project) return bad("not_found", 404);
  if (project.status !== "adopt") return bad("not_up_for_adoption", 409);
  const { month } = votingMonth();
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE user_id = ? AND month = ?").bind(session.userId, month).first();
  if (mine.n >= MAX_PROPOSALS_PER_USER) return bad("too_many_proposals", 429);
  try {
    const r = await env.DB.prepare("INSERT INTO proposals (project_id, user_id, goal, month) VALUES (?, ?, ?, ?)")
      .bind(id, session.userId, goal, month).run();
    return privateJson({ ok: true, id: r.meta.last_row_id, month }, 201);
  } catch {
    return bad("already_proposed", 409); // one proposal per project per month
  }
}

// POST /api/proposals/<id>/delete : the proposer can withdraw their own proposal (its votes go with it).
export async function withdrawProposal(request, env, session, id) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const { month } = votingMonth();
  const r = await env.DB.prepare("DELETE FROM proposals WHERE id = ? AND user_id = ? AND month = ?").bind(id, session.userId, month).run();
  // The count includes the votes removed along with the proposal, so it can be more than one.
  if (!r.meta || r.meta.changes < 1) return bad("not_found", 404);
  return privateJson({ ok: true });
}
