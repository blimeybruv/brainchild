// Sign-in (GitHub and GitLab.com), linked sign-ins, and sessions.
//
// One Brainchild account can have a GitHub sign-in, a GitLab.com sign-in, or both (table
// `identities`). A second sign-in is only ever linked by the person completing it while already
// signed in, from their account page; never by matching an email address. No email address is
// ever requested or stored.
//
// How it works (GitHub; GitLab works the same way under /api/auth/gitlab/...):
//   /api/auth/login     sends the visitor to GitHub, with a one-time "state" value and a PKCE
//                       challenge. Both are remembered in a short-lived cookie.
//   /api/auth/callback  GitHub sends the visitor back. We check the state against the cookie
//                       (so nobody can sign a visitor in to an account they didn't choose),
//                       swap the code for a token, ask GitHub who the user is, and start a session.
//   /api/auth/logout    ends the session and revokes the token at GitHub.
//   /api/me             tells the page who is signed in (handle and avatar only).
//   ?link=1             on a login link: add that provider to the signed-in account instead.
//   /api/auth/login with no provider sends the visitor to signin.html to choose one.
//
// What is stored: the session cookie holds a random id; the database holds only a hash of it,
// so a copy of the database can't be used to sign in as anyone. GitHub tokens are kept
// encrypted, server-side only, and are never sent to the browser. From GitHub we request no
// scopes, so the token reads public information only. From GitLab we request read_user and
// read_api: read-only, and needed to see a person's role on a project.

import {
  siteOrigin, privateJson, redirect, parseCookies, cookie, isSameOrigin, nowSeconds,
  b64urlEncode, b64urlDecode, randomToken, sha256, sha256Hex, timingSafeEqual
} from "./http.js";

const SESSION_COOKIE = "__Host-bc_session";
const OAUTH_COOKIE = "__Host-bc_oauth";
const SESSION_TTL = 30 * 24 * 3600; // 30 days
const OAUTH_TTL = 600;              // 10 minutes to finish signing in
const CALLBACK_PATH = "/api/auth/callback";
const GITLAB_CALLBACK_PATH = "/api/auth/gitlab/callback";
export const USER_AGENT = "brainchild.nexus";
// The branch preview is registered as a second return address in the GitLab app, so GitLab
// sign-in can be tried there before it goes live. GitHub returns only to the real site.
const GITLAB_EXTRA_ORIGINS = ["https://claude-handoff-step-1-hhjfyd-royal-firefly-b80b.blimeybruv.workers.dev"];

function webBase(env) { return env.GITHUB_WEB_BASE || "https://github.com"; }
export function apiBase(env) { return env.GITHUB_API_BASE || "https://api.github.com"; }
export function gitlabWebBase(env) { return env.GITLAB_WEB_BASE || "https://gitlab.com"; }
export function gitlabApiBase(env) { return env.GITLAB_API_BASE || "https://gitlab.com/api/v4"; }

// The two secrets are pasted into the Cloudflare dashboard by hand, so ignore any stray
// space or line break around them.
function clientId(env) { return typeof env.GITHUB_CLIENT_ID === "string" ? env.GITHUB_CLIENT_ID.trim() : ""; }
function clientSecret(env) { return typeof env.GITHUB_CLIENT_SECRET === "string" ? env.GITHUB_CLIENT_SECRET.trim() : ""; }
function gitlabId(env) { return typeof env.GITLAB_CLIENT_ID === "string" ? env.GITLAB_CLIENT_ID.trim() : ""; }
function gitlabSecret(env) { return typeof env.GITLAB_CLIENT_SECRET === "string" ? env.GITLAB_CLIENT_SECRET.trim() : ""; }
export function gitlabConfigured(env) { return !!(gitlabId(env) && gitlabSecret(env)); }
// Where GitLab sign-in may start and finish: the real site, and the registered preview.
function gitlabOrigin(env, url) {
  return url.origin === siteOrigin(env) || GITLAB_EXTRA_ORIGINS.includes(url.origin) ? url.origin : null;
}

// Who may see the moderation queue: GitHub account ids (permanent, unlike handles).
const MODERATOR_GITHUB_IDS = [255218751]; // @blimeybruv, the site owner
export function isModerator(env, session) {
  if (!session || !session.githubId) return false;
  const ids = typeof env.MODERATOR_GITHUB_IDS === "string" && env.MODERATOR_GITHUB_IDS.trim()
    ? env.MODERATOR_GITHUB_IDS.split(",").map((x) => Number(x.trim()))
    : MODERATOR_GITHUB_IDS;
  return ids.includes(session.githubId);
}

export function signInConfigured(env) {
  return !!(clientId(env) && clientSecret(env));
}

// ---------- Token encryption (AES-GCM, key derived from the OAuth client secret) ----------

let cachedKey = null;
let cachedKeySecret = null;

async function tokenKey(env) {
  const secret = clientSecret(env);
  if (cachedKey && cachedKeySecret === secret) return cachedKey;
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  cachedKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("brainchild.nexus"), info: enc.encode("github-token-encryption-v1") },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  cachedKeySecret = secret;
  return cachedKey;
}

// "bind" ties the encrypted value to one session row (and, for GitLab tokens, to GitLab), so it
// can't be copied to another row or column.
export async function seal(env, text, bind) {
  if (!text) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(bind) },
    await tokenKey(env), new TextEncoder().encode(text)
  );
  const out = new Uint8Array(12 + data.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(data), 12);
  return b64urlEncode(out);
}

export async function unseal(env, sealed, bind) {
  if (!sealed) return null;
  try {
    const raw = b64urlDecode(sealed);
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(bind) },
      await tokenKey(env), raw.slice(12)
    );
    return new TextDecoder().decode(data);
  } catch {
    return null; // wrong key (for example the client secret was replaced) or damaged data
  }
}

// ---------- Helpers ----------

// Only ever send people back to a page on this site.
function safeReturnTo(raw, origin) {
  if (typeof raw !== "string" || raw.length > 512 || raw[0] !== "/") return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(raw) || raw.startsWith("//")) return "/";
  let u;
  try { u = new URL(raw, origin); } catch { return "/"; }
  if (u.origin !== origin) return "/";
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return "/";
  return u.pathname + u.search + u.hash;
}

// Adds ?signin=<code> so the page can show a short message.
function withNotice(path, code, origin) {
  const u = new URL(path, origin);
  u.searchParams.set("signin", code);
  return u.pathname + u.search + u.hash;
}

// Turns a token endpoint's answer into { access, accessExpires, refresh, refreshExpires } or { error }.
async function readTokens(res) {
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!data || typeof data.access_token !== "string" || !data.access_token) {
    return { error: (data && typeof data.error === "string" && data.error) || "http_" + res.status };
  }
  const now = nowSeconds();
  const seconds = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);
  return {
    access: data.access_token,
    accessExpires: seconds(data.expires_in) ? now + seconds(data.expires_in) : null,
    refresh: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null,
    refreshExpires: seconds(data.refresh_token_expires_in) ? now + seconds(data.refresh_token_expires_in) : null
  };
}

// GitLab's token endpoint: the first exchange and refreshing. GitLab replaces the refresh token each time.
export async function gitlabTokenRequest(env, params, origin) {
  const res = await fetch(gitlabWebBase(env) + "/oauth/token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
    body: new URLSearchParams({ client_id: gitlabId(env), client_secret: gitlabSecret(env), redirect_uri: (origin || siteOrigin(env)) + GITLAB_CALLBACK_PATH, ...params })
  });
  return readTokens(res);
}

// GitHub's token endpoint: used for the first exchange and for refreshing.
export async function tokenRequest(env, params) {
  const body = new URLSearchParams({
    client_id: clientId(env),
    client_secret: clientSecret(env),
    ...params
  });
  const res = await fetch(webBase(env) + "/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
    body
  });
  return readTokens(res);
}

// ---------- Users and linked sign-ins ----------

// Tables that show a person has used the site. An account with none of these can be merged into
// another automatically when its sign-in is linked there; otherwise a moderator has to do it.
export const ACTIVITY = [
  ["projects", "owner_id"], ["lineage", "user_id"], ["license_records", "recorded_by"], ["comments", "user_id"],
  ["comment_likes", "user_id"], ["reports", "reporter_id"], ["reports", "resolved_by"], ["screenshots", "uploaded_by"],
  ["builds", "created_by"], ["project_changes", "user_id"], ["outside_reports", "resolved_by"], ["relay_entries", "user_id"],
  ["relay_votes", "voter_id"], ["proposals", "user_id"], ["votes", "user_id"], ["posts", "author_id"], ["relay_claims", "user_id"],
  ["relay_contributions", "user_id"], ["relay_contributions", "flagged_by"], ["relay_contributions", "flag_decided_by"],
  ["relay_badges", "user_id"], ["relay_badges", "awarded_by"], ["moderation_actions", "affected_user_id"], ["moderation_actions", "moderator_id"]
];
export async function hasActivity(env, userId) {
  // D1 limits how many SELECTs one UNION may join, so ask in a few small groups.
  for (let i = 0; i < ACTIVITY.length; i += 4) {
    const q = ACTIVITY.slice(i, i + 4).map(([t, c]) => `EXISTS (SELECT 1 FROM ${t} WHERE ${c} = ?1)`).join(" OR ");
    const r = await env.DB.prepare(`SELECT (${q}) AS used`).bind(userId).first();
    if (r && r.used) return true;
  }
  return false;
}

// A handle nobody else holds: the wanted one if it's free, otherwise with the provider added.
async function freeHandle(env, wanted, tag, selfId) {
  const tries = [wanted, wanted + "-" + tag];
  for (let i = 2; i <= 9; i++) tries.push(wanted + "-" + tag + i);
  for (const h of tries) {
    const taken = await env.DB.prepare("SELECT id FROM users WHERE handle = ? COLLATE NOCASE AND id IS NOT ?").bind(h, selfId || null).first();
    if (!taken) return h;
  }
  return wanted + "-" + tag + "-" + crypto.randomUUID().slice(0, 8);
}

async function findIdentity(env, provider, providerUserId) {
  return env.DB.prepare("SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?").bind(provider, String(providerUserId)).first();
}

async function saveIdentity(env, userId, p) {
  await env.DB.prepare(
    `INSERT INTO identities (user_id, provider, provider_user_id, handle, avatar_url, provider_created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, handle = excluded.handle, avatar_url = excluded.avatar_url,
       provider_created_at = COALESCE(excluded.provider_created_at, identities.provider_created_at)`
  ).bind(userId, p.provider, String(p.id), p.handle, p.avatar, p.createdAt).run();
  if (p.provider === "github") await env.DB.prepare("UPDATE users SET github_id = ? WHERE id = ?").bind(p.id, userId).run();
}

// The account a sign-in belongs to, creating one for a first sign-in.
// p: { provider, id (number), handle, avatar, createdAt }
async function accountFor(env, p) {
  if (p.provider === "github") {
    // GitHub handles can be renamed and later taken by someone else. If another GitHub account
    // here still holds this handle, move it aside; it is corrected the next time that person signs in.
    await env.DB.prepare(
      "UPDATE users SET handle = 'gh~' || github_id WHERE handle = ?1 COLLATE NOCASE AND github_id IS NOT NULL AND github_id <> ?2"
    ).bind(p.handle, p.id).run();
  }
  let userId = null;
  const ident = await findIdentity(env, p.provider, p.id);
  if (ident) userId = ident.user_id;
  if (!userId && p.provider === "github") {
    // Accounts from before linked sign-ins existed.
    const known = await env.DB.prepare("SELECT id FROM users WHERE github_id = ?").bind(p.id).first();
    if (known) userId = known.id;
    // A record created before sign-in existed (for example the maker of a seeded listing). Only a
    // record with no sign-in of any kind can be claimed this way, never another person's account.
    if (!userId) {
      const seeded = await env.DB.prepare(
        "SELECT u.id FROM users u WHERE u.handle = ? COLLATE NOCASE AND u.github_id IS NULL AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id)"
      ).bind(p.handle).first();
      if (seeded) userId = seeded.id;
    }
  }
  if (userId) {
    // The handle follows GitHub when the account has a GitHub sign-in, otherwise GitLab.
    const hasGithub = p.provider === "github" || !!(await env.DB.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = 'github'").bind(userId).first());
    if (p.provider === "github" || !hasGithub) {
      const handle = await freeHandle(env, p.handle, p.provider === "github" ? "gh" : "gl", userId);
      await env.DB.prepare("UPDATE users SET handle = ?, avatar_url = ? WHERE id = ?").bind(handle, p.avatar, userId).run();
    }
    await saveIdentity(env, userId, p);
    return userId;
  }
  userId = crypto.randomUUID();
  const handle = await freeHandle(env, p.handle, p.provider === "github" ? "gh" : "gl", null);
  await env.DB.prepare("INSERT INTO users (id, handle, github_id, avatar_url) VALUES (?, ?, ?, ?)")
    .bind(userId, handle, p.provider === "github" ? p.id : null, p.avatar).run();
  await saveIdentity(env, userId, p);
  return userId;
}

// ---------- Sessions ----------

// Returns the signed-in session for this request, or null.
export async function getSession(request, env) {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid || sid.length > 100) return null;
  const idHash = await sha256Hex(sid);
  const row = await env.DB.prepare(
    `SELECT s.id_hash, s.user_id, s.gh_access, s.gh_access_expires_at, s.gh_refresh, s.gh_refresh_expires_at,
            s.gl_access, s.gl_access_expires_at, s.gl_refresh,
            u.handle, u.avatar_url, u.github_id,
            (SELECT i.provider_user_id FROM identities i WHERE i.user_id = u.id AND i.provider = 'gitlab') AS gitlab_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ?`
  ).bind(idHash, nowSeconds()).first();
  if (!row) return null;
  return {
    idHash: row.id_hash, userId: row.user_id, handle: row.handle, avatarUrl: row.avatar_url, githubId: row.github_id,
    gitlabId: row.gitlab_id ? Number(row.gitlab_id) : null,
    access: row.gh_access, accessExpires: row.gh_access_expires_at,
    refresh: row.gh_refresh, refreshExpires: row.gh_refresh_expires_at,
    glAccess: row.gl_access, glAccessExpires: row.gl_access_expires_at, glRefresh: row.gl_refresh
  };
}

// Sealed token columns for one provider, ready to store on a session row.
async function tokenColumns(env, provider, tokens, idHash) {
  return provider === "github"
    ? { gh_access: await seal(env, tokens.access, idHash), gh_access_expires_at: tokens.accessExpires,
        gh_refresh: await seal(env, tokens.refresh, idHash), gh_refresh_expires_at: tokens.refreshExpires, gh_refresh_lock: null }
    : { gl_access: await seal(env, tokens.access, idHash + "|gitlab"), gl_access_expires_at: tokens.accessExpires,
        gl_refresh: await seal(env, tokens.refresh, idHash + "|gitlab"), gl_refresh_lock: null };
}

// ---------- Routes ----------

// The short-lived cookie that carries one sign-in attempt: state, PKCE verifier, where to go back
// to, the provider, and (when linking) a hash of the session that started it.
function rememberAttempt(state, verifier, returnTo, provider, linkTo) {
  return [state, verifier, b64urlEncode(new TextEncoder().encode(returnTo)), provider, linkTo || "-"].join(".");
}
function readAttempt(request, origin) {
  const parts = (parseCookies(request)[OAUTH_COOKIE] || "").split(".");
  let returnTo = "/";
  if (parts.length === 5) {
    try { returnTo = safeReturnTo(new TextDecoder().decode(b64urlDecode(parts[2])), origin); } catch { returnTo = "/"; }
  }
  return parts.length === 5 ? { state: parts[0], verifier: parts[1], returnTo, provider: parts[3], linkTo: parts[4] === "-" ? null : parts[4] } : { returnTo };
}

// Linking starts only from a signed-in session; the callback must come back to the same one.
async function linkTarget(request, env, url) {
  if (url.searchParams.get("link") !== "1") return { ok: true, linkTo: null };
  const session = await getSession(request, env);
  if (!session) return { ok: false };
  return { ok: true, linkTo: await sha256Hex("link|" + session.idHash) };
}

export async function login(request, env, url) {
  const origin = siteOrigin(env);
  const returnTo = safeReturnTo(url.searchParams.get("return_to") || "/", origin);
  // With two ways to sign in, a plain "Sign in" link goes to the page where people choose.
  if (url.searchParams.get("provider") !== "github" && url.searchParams.get("link") !== "1" && gitlabConfigured(env)) {
    return redirect("/signin.html?return_to=" + encodeURIComponent(returnTo));
  }
  // Previews and other addresses can't complete sign-in: GitHub only returns to the real site.
  if (url.origin !== origin || !signInConfigured(env)) {
    return redirect(withNotice(returnTo, "unavailable", origin));
  }
  const link = await linkTarget(request, env, url);
  if (!link.ok) return redirect(withNotice(returnTo, "failed", origin));
  const state = randomToken(32);
  const verifier = randomToken(32);
  const query = new URLSearchParams({
    client_id: clientId(env),
    redirect_uri: origin + CALLBACK_PATH,
    state,
    code_challenge: b64urlEncode(await sha256(verifier)),
    code_challenge_method: "S256"
  });
  return redirect(webBase(env) + "/login/oauth/authorize?" + query, [cookie(OAUTH_COOKIE, rememberAttempt(state, verifier, returnTo, "github", link.linkTo), OAUTH_TTL)]);
}

export async function gitlabLogin(request, env, url) {
  const site = siteOrigin(env);
  const origin = gitlabOrigin(env, url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to") || "/", url.origin);
  if (!origin || !gitlabConfigured(env)) return redirect(withNotice(returnTo, "unavailable", url.origin === site ? site : url.origin));
  const link = await linkTarget(request, env, url);
  if (!link.ok) return redirect(withNotice(returnTo, "failed", origin));
  const state = randomToken(32);
  const verifier = randomToken(32);
  const query = new URLSearchParams({
    client_id: gitlabId(env),
    redirect_uri: origin + GITLAB_CALLBACK_PATH,
    response_type: "code",
    scope: "read_user read_api",
    state,
    code_challenge: b64urlEncode(await sha256(verifier)),
    code_challenge_method: "S256"
  });
  return redirect(gitlabWebBase(env) + "/oauth/authorize?" + query, [cookie(OAUTH_COOKIE, rememberAttempt(state, verifier, returnTo, "gitlab", link.linkTo), OAUTH_TTL)]);
}

// Checks the returning request against the remembered attempt. Returns { attempt } or { fail }.
function checkReturn(request, url, origin, provider) {
  const attempt = readAttempt(request, origin);
  const clear = cookie(OAUTH_COOKIE, "", 0);
  const fail = (code) => ({ fail: redirect(withNotice(attempt.returnTo, code, origin), [clear]) });
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "denied" : "failed");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!attempt.state || attempt.provider !== provider || !code || code.length > 300 || !timingSafeEqual(state, attempt.state)) return fail("failed");
  return { attempt, code, clear, failWith: fail };
}

// Signs in, or links the sign-in to the current account. p is the provider's profile.
async function finish(request, env, origin, attempt, clear, fail, p, tokens) {
  const now = nowSeconds();
  if (attempt.linkTo) {
    const session = await getSession(request, env);
    if (!session || !timingSafeEqual(await sha256Hex("link|" + session.idHash), attempt.linkTo)) return fail("failed").fail;
    const other = await findIdentity(env, p.provider, p.id);
    if (other && other.user_id !== session.userId) {
      // This sign-in already has an account of its own. An unused one is folded into this
      // account; one with any activity needs a moderator, so nothing is lost by mistake.
      // One sign-in per provider per account: this account must not already have one of the same kind.
      const clash = await env.DB.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider IN (SELECT provider FROM identities WHERE user_id = ?)")
        .bind(session.userId, other.user_id).first();
      if (clash) return fail("already_linked").fail;
      if (await hasActivity(env, other.user_id)) return fail("link_conflict").fail;
      await env.DB.batch([
        env.DB.prepare("UPDATE identities SET user_id = ? WHERE user_id = ?").bind(session.userId, other.user_id),
        env.DB.prepare("UPDATE users SET github_id = NULL WHERE id = ?").bind(other.user_id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(other.user_id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(other.user_id)
      ]);
    } else if (!other) {
      // One sign-in per provider per account.
      const same = await env.DB.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = ?").bind(session.userId, p.provider).first();
      if (same) return fail("already_linked").fail;
    }
    await saveIdentity(env, session.userId, p);
    // The new token also goes on this session, so the person can act on that provider's projects now.
    const cols = await tokenColumns(env, p.provider, tokens, session.idHash);
    await env.DB.prepare(`UPDATE sessions SET ${Object.keys(cols).map((k) => k + " = ?").join(", ")} WHERE id_hash = ?`)
      .bind(...Object.values(cols), session.idHash).run();
    return redirect(withNotice(attempt.returnTo, other && other.user_id === session.userId ? "connected" : "linked", origin), [clear]);
  }
  const userId = await accountFor(env, p);
  const sid = randomToken(32);
  const idHash = await sha256Hex(sid);
  const cols = await tokenColumns(env, p.provider, tokens, idHash);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare(`INSERT INTO sessions (id_hash, user_id, created_at, expires_at, ${Object.keys(cols).join(", ")}) VALUES (?, ?, ?, ?, ${Object.keys(cols).map(() => "?").join(", ")})`)
      .bind(idHash, userId, now, now + SESSION_TTL, ...Object.values(cols))
  ]);
  return redirect(attempt.returnTo, [clear, cookie(SESSION_COOKIE, sid, SESSION_TTL)]);
}

export async function callback(request, env, url) {
  const origin = siteOrigin(env);
  if (url.origin !== origin || !signInConfigured(env)) return redirect(withNotice("/", "unavailable", origin), [cookie(OAUTH_COOKIE, "", 0)]);
  const r = checkReturn(request, url, origin, "github");
  if (r.fail) return r.fail;
  const tokens = await tokenRequest(env, { code: r.code, redirect_uri: origin + CALLBACK_PATH, code_verifier: r.attempt.verifier });
  if (tokens.error) {
    console.error("sign-in: token exchange failed:", tokens.error);
    return r.failWith("failed").fail;
  }
  // Ask GitHub who this is. Only the numeric id and the handle are used.
  const who = await fetch(apiBase(env) + "/user", {
    headers: { authorization: "Bearer " + tokens.access, accept: "application/vnd.github+json", "user-agent": USER_AGENT }
  });
  let profile = null;
  try { profile = await who.json(); } catch { profile = null; }
  const githubId = profile && Number.isSafeInteger(profile.id) && profile.id > 0 ? profile.id : null;
  const handle = profile && typeof profile.login === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(profile.login) ? profile.login : null;
  if (!who.ok || !githubId || !handle) {
    console.error("sign-in: could not read the GitHub profile, status", who.status);
    return r.failWith("failed").fail;
  }
  const created = profile && typeof profile.created_at === "string" && /^\d{4}-\d\d-\d\dT/.test(profile.created_at) ? profile.created_at.slice(0, 19).replace("T", " ") : null;
  return finish(request, env, origin, r.attempt, r.clear, r.failWith, {
    provider: "github", id: githubId, handle, avatar: "https://avatars.githubusercontent.com/u/" + githubId + "?v=4", createdAt: created
  }, tokens);
}

export async function gitlabCallback(request, env, url) {
  const origin = gitlabOrigin(env, url);
  if (!origin || !gitlabConfigured(env)) return redirect(withNotice("/", "unavailable", siteOrigin(env)), [cookie(OAUTH_COOKIE, "", 0)]);
  const r = checkReturn(request, url, origin, "gitlab");
  if (r.fail) return r.fail;
  const tokens = await gitlabTokenRequest(env, { code: r.code, grant_type: "authorization_code", code_verifier: r.attempt.verifier }, origin);
  if (tokens.error) {
    console.error("sign-in: GitLab token exchange failed:", tokens.error);
    return r.failWith("failed").fail;
  }
  // Ask GitLab who this is. Only the numeric id, the username and the account's age are kept.
  const who = await fetch(gitlabApiBase(env) + "/user", { headers: { authorization: "Bearer " + tokens.access, accept: "application/json", "user-agent": USER_AGENT } });
  let profile = null;
  try { profile = await who.json(); } catch { profile = null; }
  const id = profile && Number.isSafeInteger(profile.id) && profile.id > 0 ? profile.id : null;
  const handle = profile && typeof profile.username === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(profile.username) ? profile.username : null;
  if (!who.ok || !id || !handle || (profile.state && profile.state !== "active")) {
    console.error("sign-in: could not read the GitLab profile, status", who.status);
    return r.failWith("failed").fail;
  }
  // Only pictures uploaded to GitLab itself are kept. A Gravatar address carries a hash of the
  // person's email address, so it is never stored or shown.
  const avatar = typeof profile.avatar_url === "string" && /^https:\/\/gitlab\.com\/uploads\/[A-Za-z0-9_./-]+$/.test(profile.avatar_url) ? profile.avatar_url : null;
  const created = typeof profile.created_at === "string" && /^\d{4}-\d\d-\d\dT/.test(profile.created_at) ? profile.created_at.slice(0, 19).replace("T", " ") : null;
  return finish(request, env, origin, r.attempt, r.clear, r.failWith, { provider: "gitlab", id, handle, avatar, createdAt: created }, tokens);
}

export async function logout(request, env, ctx) {
  if (!isSameOrigin(request)) return privateJson({ error: "forbidden" }, 403);
  const session = await getSession(request, env);
  const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "set-cookie": cookie(SESSION_COOKIE, "", 0) };
  if (session) {
    await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(session.idHash).run();
    const access = await unseal(env, session.access, session.idHash);
    if (access && signInConfigured(env)) {
      // Tell GitHub to cancel this token too. Best effort: signing out here succeeds either way.
      ctx.waitUntil(fetch(apiBase(env) + "/applications/" + encodeURIComponent(clientId(env)) + "/token", {
        method: "DELETE",
        headers: {
          authorization: "Basic " + btoa(clientId(env) + ":" + clientSecret(env)),
          accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": USER_AGENT
        },
        body: JSON.stringify({ access_token: access })
      }).then((r) => { if (!r.ok && r.status !== 404 && r.status !== 422) console.error("sign-out: revoke failed, status", r.status); })
        .catch(() => console.error("sign-out: revoke request failed")));
    }
    const glAccess = await unseal(env, session.glAccess, session.idHash + "|gitlab");
    if (glAccess && gitlabConfigured(env)) {
      ctx.waitUntil(fetch(gitlabWebBase(env) + "/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
        body: new URLSearchParams({ client_id: gitlabId(env), client_secret: gitlabSecret(env), token: glAccess })
      }).then((r) => { if (!r.ok) console.error("sign-out: GitLab revoke failed, status", r.status); })
        .catch(() => console.error("sign-out: GitLab revoke request failed")));
    }
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function me(request, env, url) {
  const session = await getSession(request, env);
  return privateJson({
    user: session ? { handle: session.handle, avatar_url: session.avatarUrl, moderator: isModerator(env, session) } : null,
    sign_in: (signInConfigured(env) && url.origin === siteOrigin(env)) || (gitlabConfigured(env) && !!gitlabOrigin(env, url)),
    // Which sign-ins work at this address (the preview can only use GitLab).
    providers: { github: signInConfigured(env) && url.origin === siteOrigin(env), gitlab: gitlabConfigured(env) && !!gitlabOrigin(env, url) }
  });
}
