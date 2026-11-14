// Relay rounds, the month of work: the winner's task board, "I'm working on this" claims,
// contributions (pull requests on the winner's repo) and junk flags.
//
// Rules encoded in this file (HANDOFF.md, "Relay rules"):
//   - Only the winning maintainer (the person who entered the winning project) posts tasks.
//   - A contribution is a pull request on the winner's repo. GitHub is asked when it is submitted:
//     the PR's author must be the signed-in person's GitHub account, its base must be the winner's
//     repo, and it must have been opened during the round's month. It doesn't have to be merged.
//   - Anyone signed in may contribute except the winner. A contribution is for a task or is a
//     "wildcard" (the contributor's own idea).
//   - The maintainer can flag a contribution as junk, with a reason. A flag does nothing by itself:
//     a moderator reviews it, and only an upheld flag stops the PR counting. An upheld flag is
//     recorded with a statement of reasons the contributor can read and ask to have reviewed once.
//   - A moderator never decides a flag they raised themself, or one on their own pull request.

import { privateJson, isSameOrigin } from "./http.js";
import { githubGet } from "./github.js";
import { isModerator } from "./auth.js";
import { bad, readJson, text, relayNow, calendar, roundFor, roundView } from "./relay.js";
import { roundBadges, canAward } from "./relay-badges.js";

const MAX_TASKS = 20;
const MAX_CONTRIBUTIONS_EACH = 5;
export const FLAG_REASONS = ["no_change", "spam", "no_effort", "ignored"];

function clean(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s.length <= max ? s : null;
}
function guard(request, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  return null;
}
const decided = (round) => round.status === "running" || round.status === "review" || round.status === "closed";

// The winning entry of a round, with what is needed to check pull requests against its repo.
async function winnerOf(env, round) {
  if (!round.winner_entry_id) return null;
  return env.DB.prepare(
    `SELECT e.id, e.user_id, e.project_id, u.handle AS maintainer, p.title, p.repo_full_name, p.repo_id
       FROM relay_entries e JOIN projects p ON p.id = e.project_id JOIN users u ON u.id = e.user_id WHERE e.id = ?`
  ).bind(round.winner_entry_id).first();
}
function statusOf(c) { return c.flag_outcome === "upheld" ? "not_counted" : c.flagged_at && !c.flag_outcome ? "under_review" : "counts"; }

// GET /api/relay[?month=2026-12] : a round as this visitor sees it
export async function relayState(env, session, url) {
  const view = await roundView(env, session, url.searchParams.get("month"));
  if (!view) return bad("not_found", 404);
  const { round, out } = view;
  if (!decided(round)) return privateJson(out);
  const w = await winnerOf(env, round);
  if (!w) return privateJson(out);
  const me = session ? session.userId : null;
  const maintainer = !!me && me === w.user_id, moderator = !!session && isModerator(env, session);
  const { results: tasks } = await env.DB.prepare("SELECT id, tag, title, detail FROM relay_tasks WHERE round_id = ? AND removed_at IS NULL ORDER BY id").bind(round.id).all();
  const { results: claims } = await env.DB.prepare(
    `SELECT c.task_id, c.user_id, u.handle FROM relay_claims c JOIN relay_tasks t ON t.id = c.task_id JOIN users u ON u.id = c.user_id
      WHERE t.round_id = ? AND t.removed_at IS NULL ORDER BY c.created_at, c.rowid`
  ).bind(round.id).all();
  const { results: rows } = await env.DB.prepare(
    `SELECT c.*, u.handle, t.title AS task_title, t.tag AS task_tag
       FROM relay_contributions c JOIN users u ON u.id = c.user_id LEFT JOIN relay_tasks t ON t.id = c.task_id
      WHERE c.round_id = ? ORDER BY c.id`
  ).bind(round.id).all();
  out.board = {
    project_id: w.project_id, project_title: w.title, maintainer: w.maintainer,
    repo: w.repo_full_name, repo_url: w.repo_full_name ? "https://github.com/" + w.repo_full_name : null,
    open: round.status === "running",                                   // tasks can be posted and claimed
    accepting: round.status === "running" || round.status === "review", // contributions can be submitted and flagged
    tasks: tasks.map((t) => ({
      id: t.id, tag: t.tag, title: t.title, detail: t.detail,
      claimed_by: claims.filter((c) => c.task_id === t.id).map((c) => c.handle),
      claimed: !!me && claims.some((c) => c.task_id === t.id && c.user_id === me)
    }))
  };
  out.contributions = rows.map((c) => {
    const mine = !!me && c.user_id === me, status = statusOf(c);
    const o = {
      id: c.id, user: c.handle, wildcard: c.task_id === null, task: c.task_title, tag: c.task_tag,
      pr_number: c.pr_number, pr_url: c.pr_url, pr_title: c.pr_title, note: c.note, created_at: c.created_at, status, mine
    };
    // Why it was flagged is for the people involved, not the public page.
    if (c.flagged_at && (mine || maintainer || moderator)) o.flag = { reason: c.flag_reason, note: c.flag_note, outcome: c.flag_outcome, reasons: c.flag_outcome ? c.flag_reasons : null };
    return o;
  });
  // Which entrants have a pull request that counts (a flag that is still being reviewed doesn't take it away).
  const counting = new Set(rows.filter((c) => statusOf(c) !== "not_counted").map((c) => c.user_id));
  const { results: entrants } = await env.DB.prepare("SELECT id, user_id FROM relay_entries WHERE round_id = ?").bind(round.id).all();
  const byEntry = new Map(entrants.map((e) => [e.id, e.user_id]));
  for (const e of out.entries) e.contributed = e.winner ? null : counting.has(byEntry.get(e.id));
  out.me.maintainer = maintainer;
  out.me.moderator = moderator;
  out.me.contributed = !!me && counting.has(me);
  // Badges and, once the month is over, the recap.
  out.badges = await roundBadges(env, round.id);
  out.me.can_award = await canAward(env, session, round, w.user_id);
  if (round.status === "review" || round.status === "closed") {
    const good = rows.filter((c) => statusOf(c) !== "not_counted");
    out.recap = {
      pull_requests: good.length, contributors: new Set(good.map((c) => c.user_id)).size,
      under_review: rows.filter((c) => statusOf(c) === "under_review").length,
      // Entrants who owed a pull request and didn't open one. Listed only when the round is final.
      missed: round.status === "closed" ? out.entries.filter((e) => e.contributed === false).map((e) => e.owner) : []
    };
  }
  return privateJson(out);
}

// The current round, if it is in its contribute stage and this person is its winning maintainer.
async function maintainerRound(env, session) {
  const round = await roundFor(env, null);
  if (round.status !== "running") return { response: bad("board_closed", 409) };
  const w = await winnerOf(env, round);
  if (!w || w.user_id !== session.userId) return { response: bad("not_maintainer", 403) };
  return { round, w };
}

// POST /api/relay/tasks  { title, tag, detail } : the winning maintainer adds a task to the board
export async function addTask(request, env, session) {
  const stop = guard(request, session);
  if (stop) return stop;
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const title = clean(body.title, 120), tag = clean(body.tag === undefined || body.tag === null || body.tag === "" ? "Task" : body.tag, 20);
  const detail = clean(body.detail === undefined || body.detail === null ? "" : body.detail, 500);
  const fields = [];
  if (!title || title.length < 5) fields.push("title");
  if (!tag) fields.push("tag");
  if (detail === null) fields.push("detail");
  if (fields.length) return bad("invalid_fields", 400, { fields });
  const m = await maintainerRound(env, session);
  if (m.response) return m.response;
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM relay_tasks WHERE round_id = ? AND removed_at IS NULL").bind(m.round.id).first();
  if (n.n >= MAX_TASKS) return bad("too_many", 409);
  const r = await env.DB.prepare("INSERT INTO relay_tasks (round_id, tag, title, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(m.round.id, tag, title, detail || null, text(relayNow(env))).run();
  return privateJson({ ok: true, task_id: r.meta.last_row_id }, 201);
}

// POST /api/relay/tasks/<id>/remove | claim | unclaim
export async function taskAction(request, env, session, id, action) {
  const stop = guard(request, session);
  if (stop) return stop;
  const round = await roundFor(env, null);
  if (round.status !== "running") return bad("board_closed", 409);
  const task = await env.DB.prepare("SELECT id FROM relay_tasks WHERE id = ? AND round_id = ? AND removed_at IS NULL").bind(id, round.id).first();
  if (!task) return bad("not_found", 404);
  const w = await winnerOf(env, round);
  const maintainer = !!w && w.user_id === session.userId;
  const now = text(relayNow(env));
  if (action === "remove") {
    if (!maintainer) return bad("not_maintainer", 403);
    // The row stays so contributions already made for the task keep its name.
    await env.DB.batch([
      env.DB.prepare("UPDATE relay_tasks SET removed_at = ? WHERE id = ?").bind(now, id),
      env.DB.prepare("DELETE FROM relay_claims WHERE task_id = ?").bind(id)
    ]);
    return privateJson({ ok: true });
  }
  if (maintainer) return bad("own_project", 409); // the board is for everyone else
  if (action === "claim") await env.DB.prepare("INSERT OR IGNORE INTO relay_claims (task_id, user_id, created_at) VALUES (?, ?, ?)").bind(id, session.userId, now).run();
  else await env.DB.prepare("DELETE FROM relay_claims WHERE task_id = ? AND user_id = ?").bind(id, session.userId).run();
  return privateJson({ ok: true });
}

const PR = /^(?:https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/pull\/)?#?(\d{1,9})(?:[/?#][^\s]*)?$/;

// POST /api/relay/contributions  { pr, task_id (or null for a wildcard), note, month }
export async function addContribution(request, env, session) {
  const stop = guard(request, session);
  if (stop) return stop;
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const note = clean(body.note, 300);
  const pr = typeof body.pr === "string" ? body.pr.trim().match(PR) : null;
  const taskId = body.task_id === null || body.task_id === undefined ? null : Number.isSafeInteger(body.task_id) ? body.task_id : NaN;
  const fields = [];
  if (!pr) fields.push("pr");
  if (!note || note.length < 10) fields.push("note");
  if (Number.isNaN(taskId)) fields.push("task_id");
  if (fields.length) return bad("invalid_fields", 400, { fields });
  const round = await roundFor(env, typeof body.month === "string" ? body.month : null);
  if (!round) return bad("not_found", 404);
  if (round.status !== "running" && round.status !== "review") return bad("contributions_closed", 409);
  const w = await winnerOf(env, round);
  if (!w || !w.repo_full_name) return bad("contributions_closed", 409);
  if (w.user_id === session.userId) return bad("own_project", 409);
  if (taskId !== null) {
    const t = await env.DB.prepare("SELECT id FROM relay_tasks WHERE id = ? AND round_id = ? AND removed_at IS NULL").bind(taskId, round.id).first();
    if (!t) return bad("invalid_fields", 400, { fields: ["task_id"] });
  }
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM relay_contributions WHERE round_id = ? AND user_id = ?").bind(round.id, session.userId).first();
  if (mine.n >= MAX_CONTRIBUTIONS_EACH) return bad("too_many", 409);

  // Ask GitHub about the pull request, as the person submitting it. A full link is looked up where
  // it points (so a renamed repo still works) and then checked against the winner's repo id.
  const number = Number(pr[3]);
  const [owner, name] = pr[1] ? [pr[1], pr[2]] : w.repo_full_name.split("/");
  const g = await githubGet(env, session, "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) + "/pulls/" + number);
  if (g.reauth) return bad("github_sign_in_again", 401);
  if (g.status === 404) return bad("pr_not_found", 404);
  const d = g.data;
  const base = d && d.base && d.base.repo;
  if (g.status !== 200 || !d || d.number !== number || !d.user || !Number.isSafeInteger(d.user.id) || !base || !Number.isSafeInteger(base.id) || typeof d.created_at !== "string") {
    console.error("relay: pull request lookup failed, status", g.status);
    return bad("github_error", 502);
  }
  const sameRepo = w.repo_id ? base.id === w.repo_id : String(base.full_name).toLowerCase() === w.repo_full_name.toLowerCase();
  if (!sameRepo) return bad("pr_wrong_repo", 409);
  if (d.user.id !== session.githubId) return bad("pr_not_yours", 409);
  const opened = new Date(d.created_at), cal = calendar(round.month);
  if (Number.isNaN(opened.getTime())) return bad("github_error", 502);
  const day = opened.toISOString().slice(0, 10);
  if (day < cal.starts || day > cal.ends) return bad("pr_outside_round", 409);
  const full = typeof base.full_name === "string" && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(base.full_name) ? base.full_name : w.repo_full_name;
  const title = clean(typeof d.title === "string" ? d.title.slice(0, 200) : "", 200) || "Pull request #" + number;
  try {
    const r = await env.DB.prepare(
      `INSERT INTO relay_contributions (round_id, user_id, task_id, pr_number, pr_url, pr_title, pr_opened_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(round.id, session.userId, taskId, number, "https://github.com/" + full + "/pull/" + number, title, text(opened), note, text(relayNow(env))).run();
    return privateJson({ ok: true, contribution_id: r.meta.last_row_id }, 201);
  } catch {
    return bad("already_submitted", 409); // each pull request is entered once
  }
}

// POST /api/relay/contributions/<id>/withdraw : take your own contribution back (not once it's flagged)
// POST /api/relay/contributions/<id>/flag  { reason, note } : the maintainer asks a moderator to look at it
export async function contributionAction(request, env, session, id, action) {
  const stop = guard(request, session);
  if (stop) return stop;
  const body = action === "flag" ? await readJson(request) : {};
  if (!body) return bad("bad_request");
  await roundFor(env, null); // moves rounds on first, so the status below is current
  const c = await env.DB.prepare(
    "SELECT c.id, c.user_id, c.flagged_at, r.status, r.winner_entry_id, r.id AS round_id FROM relay_contributions c JOIN relay_rounds r ON r.id = c.round_id WHERE c.id = ?"
  ).bind(id).first();
  if (!c) return bad("not_found", 404);
  if (c.status !== "running" && c.status !== "review") return bad("contributions_closed", 409);
  if (action === "withdraw") {
    if (c.user_id !== session.userId) return bad("forbidden", 403);
    const r = await env.DB.prepare("DELETE FROM relay_contributions WHERE id = ? AND user_id = ? AND flagged_at IS NULL").bind(id, session.userId).run();
    if (!r.meta || r.meta.changes < 1) return bad("already_flagged", 409);
    return privateJson({ ok: true });
  }
  const w = await winnerOf(env, { winner_entry_id: c.winner_entry_id });
  if (!w || w.user_id !== session.userId) return bad("not_maintainer", 403);
  const reason = FLAG_REASONS.includes(body.reason) ? body.reason : null;
  const note = clean(body.note === undefined || body.note === null ? "" : body.note, 500);
  if (!reason || note === null) return bad("invalid_fields", 400, { fields: [reason ? "note" : "reason"] });
  const r = await env.DB.prepare(
    "UPDATE relay_contributions SET flag_reason = ?, flag_note = ?, flagged_by = ?, flagged_at = ? WHERE id = ? AND flagged_at IS NULL"
  ).bind(reason, note || null, session.userId, text(relayNow(env)), id).run();
  if (!r.meta || r.meta.changes < 1) return bad("already_flagged", 409); // one flag per pull request
  return privateJson({ ok: true });
}

// ---------- moderators ----------

// Flags waiting for a moderator (or, with closed = true, the ones already decided).
export async function listFlags(env, closed) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.pr_number, c.pr_url, c.pr_title, c.note, c.flag_reason, c.flag_note, c.flagged_at, c.flag_outcome, c.flag_reasons, c.flag_decided_at,
            u.handle AS contributor, f.handle AS flagged_by, r.month, p.id AS project_id, p.title AS project_title
       FROM relay_contributions c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users f ON f.id = c.flagged_by
       JOIN relay_rounds r ON r.id = c.round_id
       JOIN relay_entries e ON e.id = r.winner_entry_id
       JOIN projects p ON p.id = e.project_id
      WHERE c.flagged_at IS NOT NULL AND c.flag_outcome IS ${closed ? "NOT NULL" : "NULL"}
      ORDER BY c.flagged_at ${closed ? "DESC" : "ASC"} LIMIT 200`
  ).all();
  return results;
}

// POST /api/mod/relay-flags/<contribution id>/resolve  { decision: "uphold" | "clear", reasons }
export async function resolveFlag(request, env, session, id) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!isModerator(env, session)) return bad("not_moderator", 403);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const decision = body.decision === "uphold" || body.decision === "clear" ? body.decision : null;
  const reasons = typeof body.reasons === "string" ? body.reasons.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
  if (!decision) return bad("invalid_fields", 400, { fields: ["decision"] });
  // A flag is never upheld without its reasons written out: the contributor reads them.
  if (reasons.length > 2000 || (decision === "uphold" && reasons.length < 10)) return bad("invalid_fields", 400, { fields: ["reasons"] });
  const c = await env.DB.prepare(
    `SELECT c.id, c.user_id, c.flag_reason, c.flagged_by, c.flagged_at, c.flag_outcome, e.project_id
       FROM relay_contributions c JOIN relay_rounds r ON r.id = c.round_id JOIN relay_entries e ON e.id = r.winner_entry_id WHERE c.id = ?`
  ).bind(id).first();
  if (!c || !c.flagged_at) return bad("not_found", 404);
  if (c.flag_outcome) return bad("already_resolved", 409);
  // Nobody decides a case they are part of: not the one who flagged, not the one whose pull request it is.
  if (c.flagged_by === session.userId) return bad("own_flag", 409);
  if (c.user_id === session.userId) return bad("own_contribution", 409);
  const now = text(new Date());
  const claim = await env.DB.prepare(
    "UPDATE relay_contributions SET flag_outcome = ?, flag_reasons = ?, flag_decided_by = ?, flag_decided_at = ? WHERE id = ? AND flag_outcome IS NULL"
  ).bind(decision === "uphold" ? "upheld" : "cleared", reasons || null, session.userId, now, id).run();
  if (!claim.meta || claim.meta.changes !== 1) return bad("already_resolved", 409);
  if (decision === "uphold") {
    // The statement of reasons goes where the contributor's other notices are, with one chance to ask for a review.
    const a = await env.DB.prepare(
      `INSERT INTO moderation_actions (target_type, project_id, comment_id, affected_user_id, action, ground, category, reasons, automated, moderator_id, report_id, created_at)
       VALUES ('relay_pr', ?, NULL, ?, 'remove', 'terms', ?, ?, 0, ?, NULL, ?)`
    ).bind(c.project_id, c.user_id, c.flag_reason, reasons, session.userId, now).run();
    await env.DB.batch([
      env.DB.prepare("UPDATE relay_contributions SET action_id = ? WHERE id = ?").bind(a.meta.last_row_id, id),
      env.DB.prepare("DELETE FROM relay_badges WHERE contribution_id = ?").bind(id) // a badge can't rest on a pull request that doesn't count
    ]);
  }
  return privateJson({ ok: true, outcome: decision === "uphold" ? "upheld" : "cleared" });
}
