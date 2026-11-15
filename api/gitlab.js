// Calls to GitLab.com on behalf of the signed-in user.
//
// GitLab access tokens last two hours. Each refresh returns a new refresh token and the old one
// stops working, so only one request per session may refresh at a time (the same claim-then-wait
// approach as github.js). Tokens are sealed with the session id plus "|gitlab".

import { nowSeconds } from "./http.js";
import { seal, unseal, gitlabTokenRequest, gitlabApiBase, USER_AGENT } from "./auth.js";

const REFRESH_MARGIN = 120;
const REFRESH_LOCK_SECONDS = 15;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const bind = (session) => session.idHash + "|gitlab";

async function forgetTokens(env, session) {
  await env.DB.prepare(
    "UPDATE sessions SET gl_access = NULL, gl_access_expires_at = NULL, gl_refresh = NULL, gl_refresh_lock = NULL WHERE id_hash = ? AND gl_access IS ?"
  ).bind(session.idHash, session.glAccess).run();
  session.glAccess = session.glRefresh = session.glAccessExpires = null;
}

async function refreshTokens(env, session) {
  const now = nowSeconds();
  const claim = await env.DB.prepare(
    "UPDATE sessions SET gl_refresh_lock = ?1 WHERE id_hash = ?2 AND gl_refresh = ?3 AND (gl_refresh_lock IS NULL OR gl_refresh_lock < ?4)"
  ).bind(now, session.idHash, session.glRefresh, now - REFRESH_LOCK_SECONDS).run();
  if (!claim.meta || claim.meta.changes !== 1) {
    for (let i = 0; i < 12; i++) {
      const row = await env.DB.prepare("SELECT gl_access, gl_access_expires_at, gl_refresh FROM sessions WHERE id_hash = ?").bind(session.idHash).first();
      if (!row) return null;
      if (row.gl_refresh !== session.glRefresh) {
        if (!row.gl_access) return null;
        session.glAccess = row.gl_access; session.glAccessExpires = row.gl_access_expires_at; session.glRefresh = row.gl_refresh;
        return unseal(env, row.gl_access, bind(session));
      }
      await sleep(250);
    }
    return null;
  }
  const refreshToken = await unseal(env, session.glRefresh, bind(session));
  if (!refreshToken) { await forgetTokens(env, session); return null; }
  const tokens = await gitlabTokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
  if (tokens.error) {
    console.error("gitlab: token refresh failed:", tokens.error);
    if (tokens.error === "invalid_grant" || tokens.error === "invalid_client") await forgetTokens(env, session);
    else await env.DB.prepare("UPDATE sessions SET gl_refresh_lock = NULL WHERE id_hash = ?").bind(session.idHash).run();
    return null;
  }
  const access = await seal(env, tokens.access, bind(session)), refresh = await seal(env, tokens.refresh, bind(session));
  await env.DB.prepare("UPDATE sessions SET gl_access = ?, gl_access_expires_at = ?, gl_refresh = ?, gl_refresh_lock = NULL WHERE id_hash = ?")
    .bind(access, tokens.accessExpires, refresh, session.idHash).run();
  session.glAccess = access; session.glAccessExpires = tokens.accessExpires; session.glRefresh = refresh;
  return tokens.access;
}

// A working GitLab token for this session, or null when the person has to connect GitLab again.
export async function gitlabToken(env, session) {
  if (!session || !session.glAccess) return null;
  if (session.glAccessExpires === null || session.glAccessExpires - REFRESH_MARGIN > nowSeconds()) return unseal(env, session.glAccess, bind(session));
  if (!session.glRefresh) { await forgetTokens(env, session); return null; }
  return refreshTokens(env, session);
}

// GET a GitLab API path as the signed-in user: { status, data } or { reauth: true }.
export async function gitlabGet(env, session, path) {
  const token = await gitlabToken(env, session);
  if (!token) return { reauth: true };
  const res = await fetch(gitlabApiBase(env) + path, { headers: { authorization: "Bearer " + token, accept: "application/json", "user-agent": USER_AGENT } });
  if (res.status === 401) { await forgetTokens(env, session); return { reauth: true }; }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}
