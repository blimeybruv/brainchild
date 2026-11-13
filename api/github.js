// Calls to GitHub on behalf of the signed-in user, and the repo ownership check.
//
// The ownership rule: a user may list a repo, or change its listing, only if GitHub says they
// are an admin of it (permissions.admin = true on GET /repos/{owner}/{repo}, asked with the
// user's own token). Every route that creates or changes a listing, and the handoff itself,
// must call requireRepoAdmin() at the moment of the change: never trust an earlier answer.

import { nowSeconds, privateJson } from "./http.js";
import { seal, unseal, tokenRequest, apiBase, USER_AGENT } from "./auth.js";

const REFRESH_MARGIN = 120; // refresh a little before the token actually runs out

const REFRESH_LOCK_SECONDS = 15;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Drops the stored tokens, but only if they are still the ones this request saw: a newer
// pair saved by another request is left alone.
async function forgetTokens(env, session) {
  await env.DB.prepare(
    `UPDATE sessions SET gh_access = NULL, gh_access_expires_at = NULL, gh_refresh = NULL,
            gh_refresh_expires_at = NULL, gh_refresh_lock = NULL
      WHERE id_hash = ? AND gh_access IS ?`
  ).bind(session.idHash, session.access).run();
  session.access = session.refresh = session.accessExpires = session.refreshExpires = null;
}

function adopt(session, row) {
  session.access = row.gh_access; session.accessExpires = row.gh_access_expires_at;
  session.refresh = row.gh_refresh; session.refreshExpires = row.gh_refresh_expires_at;
}

// A refresh token works exactly once, so only one request per session may use it. The first
// request claims the row; any others that arrive at the same moment wait for its result.
async function refreshTokens(env, session) {
  const now = nowSeconds();
  const claim = await env.DB.prepare(
    `UPDATE sessions SET gh_refresh_lock = ?1
      WHERE id_hash = ?2 AND gh_refresh = ?3 AND (gh_refresh_lock IS NULL OR gh_refresh_lock < ?4)`
  ).bind(now, session.idHash, session.refresh, now - REFRESH_LOCK_SECONDS).run();

  if (!claim.meta || claim.meta.changes !== 1) {
    // Another request is refreshing, or has just finished. Wait for the tokens it saves.
    for (let i = 0; i < 12; i++) {
      const row = await env.DB.prepare(
        "SELECT gh_access, gh_access_expires_at, gh_refresh, gh_refresh_expires_at FROM sessions WHERE id_hash = ?"
      ).bind(session.idHash).first();
      if (!row) return null;
      if (row.gh_refresh !== session.refresh) {
        if (!row.gh_access) return null;
        adopt(session, row);
        return unseal(env, row.gh_access, session.idHash);
      }
      await sleep(250);
    }
    return null;
  }

  const refreshToken = await unseal(env, session.refresh, session.idHash);
  if (!refreshToken) { await forgetTokens(env, session); return null; }
  const tokens = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
  if (tokens.error) {
    console.error("github: token refresh failed:", tokens.error);
    if (tokens.error === "bad_refresh_token" || tokens.error === "incorrect_client_credentials") {
      await forgetTokens(env, session); // GitHub rejected it: the user has to sign in again
    } else {
      // A temporary fault at GitHub: keep the tokens and let the next request try again.
      await env.DB.prepare("UPDATE sessions SET gh_refresh_lock = NULL WHERE id_hash = ?").bind(session.idHash).run();
    }
    return null;
  }
  const row = {
    gh_access: await seal(env, tokens.access, session.idHash), gh_access_expires_at: tokens.accessExpires,
    gh_refresh: await seal(env, tokens.refresh, session.idHash), gh_refresh_expires_at: tokens.refreshExpires
  };
  await env.DB.prepare(
    `UPDATE sessions SET gh_access = ?, gh_access_expires_at = ?, gh_refresh = ?, gh_refresh_expires_at = ?,
            gh_refresh_lock = NULL WHERE id_hash = ?`
  ).bind(row.gh_access, row.gh_access_expires_at, row.gh_refresh, row.gh_refresh_expires_at, session.idHash).run();
  adopt(session, row);
  return tokens.access;
}

// Returns a working GitHub token for this session, refreshing it if it has run out.
// Returns null when the user has to sign in again (or GitHub is briefly unavailable).
export async function githubToken(env, session) {
  if (!session || !session.access) return null;
  const now = nowSeconds();
  if (session.accessExpires === null || session.accessExpires - REFRESH_MARGIN > now) {
    return unseal(env, session.access, session.idHash);
  }
  if (!session.refresh || (session.refreshExpires !== null && session.refreshExpires <= now)) {
    await forgetTokens(env, session);
    return null;
  }
  return refreshTokens(env, session);
}

// GET a GitHub API path as the signed-in user.
// Returns { status, data }, or { reauth: true } when the user must sign in again.
export async function githubGet(env, session, path) {
  const token = await githubToken(env, session);
  if (!token) return { reauth: true };
  const res = await fetch(apiBase(env) + path, {
    headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": USER_AGENT }
  });
  if (res.status === 401) {
    // The user withdrew access on GitHub, or the token was cancelled.
    await forgetTokens(env, session);
    return { reauth: true };
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
function validName(s) { return typeof s === "string" && NAME.test(s) && s !== "." && s !== ".."; }

// Looks the repo up on GitHub as the signed-in user.
// Result: { ok: true, admin, repo } or { ok: false, error, status }.
export async function repoAccess(env, session, owner, name) {
  if (!validName(owner) || !validName(name)) return { ok: false, error: "bad_repo_name", status: 400 };
  const r = await githubGet(env, session, "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name));
  if (r.reauth) return { ok: false, error: "github_sign_in_again", status: 401 };
  if (r.status === 404) return { ok: false, error: "repo_not_found", status: 404 };
  const d = r.data;
  if (r.status !== 200 || !d || !Number.isSafeInteger(d.id) || typeof d.full_name !== "string") {
    console.error("github: repo lookup failed, status", r.status);
    return { ok: false, error: "github_error", status: 502 };
  }
  // Anything other than an explicit "true" from GitHub counts as "not an admin".
  const admin = !!(d.permissions && d.permissions.admin === true);
  return {
    ok: true,
    admin,
    repo: {
      id: d.id,
      full_name: d.full_name, // GitHub's current name, which may differ after a rename or transfer
      owner: d.owner && typeof d.owner.login === "string" ? d.owner.login : null,
      name: typeof d.name === "string" ? d.name : null,
      url: typeof d.html_url === "string" ? d.html_url : null,
      private: d.private === true,
      fork: d.fork === true,
      parent: d.parent && typeof d.parent.full_name === "string" ? d.parent.full_name : null,
      parent_id: d.parent && Number.isSafeInteger(d.parent.id) ? d.parent.id : null,
      archived: d.archived === true,
      default_branch: typeof d.default_branch === "string" ? d.default_branch : null,
      license: d.license && typeof d.license.spdx_id === "string" ? d.license.spdx_id : null
    }
  };
}

// For routes that create or change a listing. Returns { repo } when the signed-in user is an
// admin of a public repo, otherwise { response } with the error to send back.
export async function requireRepoAdmin(env, session, owner, name) {
  if (!session) return { response: privateJson({ error: "not_signed_in" }, 401) };
  const r = await repoAccess(env, session, owner, name);
  if (!r.ok) return { response: privateJson({ error: r.error }, r.status) };
  if (r.repo.private) return { response: privateJson({ error: "repo_not_public" }, 403) };
  if (!r.admin) return { response: privateJson({ error: "not_repo_admin" }, 403) };
  return { repo: r.repo };
}

// GET /api/repos/{owner}/{repo}/access: lets the listing form show whether this repo can be listed.
export async function repoAccessRoute(env, session, owner, name) {
  if (!session) return privateJson({ error: "not_signed_in" }, 401);
  const r = await repoAccess(env, session, owner, name);
  if (!r.ok) return privateJson({ error: r.error }, r.status);
  return privateJson({ admin: r.admin, can_list: r.admin && !r.repo.private, repo: r.repo });
}
