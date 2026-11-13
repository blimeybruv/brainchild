// GitHub sign-in and sessions.
//
// How it works:
//   /api/auth/login     sends the visitor to GitHub, with a one-time "state" value and a PKCE
//                       challenge. Both are remembered in a short-lived cookie.
//   /api/auth/callback  GitHub sends the visitor back. We check the state against the cookie
//                       (so nobody can sign a visitor in to an account they didn't choose),
//                       swap the code for a token, ask GitHub who the user is, and start a session.
//   /api/auth/logout    ends the session and revokes the token at GitHub.
//   /api/me             tells the page who is signed in (handle and avatar only).
//
// What is stored: the session cookie holds a random id; the database holds only a hash of it,
// so a copy of the database can't be used to sign in as anyone. GitHub tokens are kept
// encrypted, server-side only, and are never sent to the browser. We request no scopes, so the
// token can read public information and nothing else. Email addresses are never requested or stored.

import {
  siteOrigin, privateJson, redirect, parseCookies, cookie, isSameOrigin, nowSeconds,
  b64urlEncode, b64urlDecode, randomToken, sha256, sha256Hex, timingSafeEqual
} from "./http.js";

const SESSION_COOKIE = "__Host-bc_session";
const OAUTH_COOKIE = "__Host-bc_oauth";
const SESSION_TTL = 30 * 24 * 3600; // 30 days
const OAUTH_TTL = 600;              // 10 minutes to finish signing in
const CALLBACK_PATH = "/api/auth/callback";
export const USER_AGENT = "brainchild.nexus";

function webBase(env) { return env.GITHUB_WEB_BASE || "https://github.com"; }
export function apiBase(env) { return env.GITHUB_API_BASE || "https://api.github.com"; }

export function signInConfigured(env) {
  return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

// ---------- Token encryption (AES-GCM, key derived from the OAuth client secret) ----------

let cachedKey = null;
let cachedKeySecret = null;

async function tokenKey(env) {
  if (cachedKey && cachedKeySecret === env.GITHUB_CLIENT_SECRET) return cachedKey;
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(env.GITHUB_CLIENT_SECRET), "HKDF", false, ["deriveKey"]);
  cachedKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("brainchild.nexus"), info: enc.encode("github-token-encryption-v1") },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  cachedKeySecret = env.GITHUB_CLIENT_SECRET;
  return cachedKey;
}

// "bind" ties the encrypted value to one session row, so it can't be copied to another.
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

// GitHub's token endpoint: used for the first exchange and for refreshing.
export async function tokenRequest(env, params) {
  const body = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    ...params
  });
  const res = await fetch(webBase(env) + "/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
    body
  });
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

// ---------- Users ----------

async function upsertUser(env, githubId, login) {
  const avatar = "https://avatars.githubusercontent.com/u/" + githubId + "?v=4";
  // GitHub handles can be renamed and later taken by someone else. If another account here
  // still holds this handle, move it aside; it is corrected the next time that person signs in.
  await env.DB.prepare(
    "UPDATE users SET handle = 'gh~' || github_id WHERE handle = ?1 COLLATE NOCASE AND github_id IS NOT NULL AND github_id <> ?2"
  ).bind(login, githubId).run();

  const known = await env.DB.prepare("SELECT id FROM users WHERE github_id = ?").bind(githubId).first();
  if (known) {
    await env.DB.prepare("UPDATE users SET handle = ?, avatar_url = ? WHERE id = ?").bind(login, avatar, known.id).run();
    return known.id;
  }
  // A record created before sign-in existed (for example the maker of a seeded listing).
  const seeded = await env.DB.prepare(
    "SELECT id FROM users WHERE handle = ? COLLATE NOCASE AND github_id IS NULL"
  ).bind(login).first();
  if (seeded) {
    await env.DB.prepare("UPDATE users SET github_id = ?, handle = ?, avatar_url = ? WHERE id = ? AND github_id IS NULL")
      .bind(githubId, login, avatar, seeded.id).run();
    return seeded.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, handle, github_id, avatar_url) VALUES (?, ?, ?, ?)")
    .bind(id, login, githubId, avatar).run();
  return id;
}

// ---------- Sessions ----------

// Returns the signed-in session for this request, or null.
export async function getSession(request, env) {
  const sid = parseCookies(request)[SESSION_COOKIE];
  if (!sid || sid.length > 100) return null;
  const idHash = await sha256Hex(sid);
  const row = await env.DB.prepare(
    `SELECT s.id_hash, s.user_id, s.gh_access, s.gh_access_expires_at, s.gh_refresh, s.gh_refresh_expires_at,
            u.handle, u.avatar_url, u.github_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ?`
  ).bind(idHash, nowSeconds()).first();
  if (!row) return null;
  return {
    idHash: row.id_hash, userId: row.user_id, handle: row.handle, avatarUrl: row.avatar_url, githubId: row.github_id,
    access: row.gh_access, accessExpires: row.gh_access_expires_at,
    refresh: row.gh_refresh, refreshExpires: row.gh_refresh_expires_at
  };
}

// ---------- Routes ----------

export async function login(request, env, url) {
  const origin = siteOrigin(env);
  const returnTo = safeReturnTo(url.searchParams.get("return_to") || "/", origin);
  // Previews and other addresses can't complete sign-in: GitHub only returns to the real site.
  if (url.origin !== origin || !signInConfigured(env)) {
    return redirect(withNotice(returnTo, "unavailable", origin));
  }
  const state = randomToken(32);
  const verifier = randomToken(32);
  const query = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: origin + CALLBACK_PATH,
    state,
    code_challenge: b64urlEncode(await sha256(verifier)),
    code_challenge_method: "S256"
  });
  const remembered = [state, verifier, b64urlEncode(new TextEncoder().encode(returnTo))].join(".");
  return redirect(webBase(env) + "/login/oauth/authorize?" + query, [cookie(OAUTH_COOKIE, remembered, OAUTH_TTL)]);
}

export async function callback(request, env, url) {
  const origin = siteOrigin(env);
  const parts = (parseCookies(request)[OAUTH_COOKIE] || "").split(".");
  const clear = cookie(OAUTH_COOKIE, "", 0);
  let returnTo = "/";
  if (parts.length === 3) {
    try { returnTo = safeReturnTo(new TextDecoder().decode(b64urlDecode(parts[2])), origin); } catch { returnTo = "/"; }
  }
  const fail = (code) => redirect(withNotice(returnTo, code, origin), [clear]);

  if (url.origin !== origin || !signInConfigured(env)) return fail("unavailable");
  if (url.searchParams.get("error")) {
    return fail(url.searchParams.get("error") === "access_denied" ? "denied" : "failed");
  }
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (parts.length !== 3 || !code || code.length > 200 || !timingSafeEqual(state, parts[0])) return fail("failed");

  const tokens = await tokenRequest(env, { code, redirect_uri: origin + CALLBACK_PATH, code_verifier: parts[1] });
  if (tokens.error) {
    console.error("sign-in: token exchange failed:", tokens.error);
    return fail("failed");
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
    return fail("failed");
  }

  const userId = await upsertUser(env, githubId, handle);
  const sid = randomToken(32);
  const idHash = await sha256Hex(sid);
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, gh_access, gh_access_expires_at, gh_refresh, gh_refresh_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      idHash, userId, now, now + SESSION_TTL,
      await seal(env, tokens.access, idHash), tokens.accessExpires,
      await seal(env, tokens.refresh, idHash), tokens.refreshExpires
    )
  ]);
  return redirect(returnTo, [clear, cookie(SESSION_COOKIE, sid, SESSION_TTL)]);
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
      ctx.waitUntil(fetch(apiBase(env) + "/applications/" + encodeURIComponent(env.GITHUB_CLIENT_ID) + "/token", {
        method: "DELETE",
        headers: {
          authorization: "Basic " + btoa(env.GITHUB_CLIENT_ID + ":" + env.GITHUB_CLIENT_SECRET),
          accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": USER_AGENT
        },
        body: JSON.stringify({ access_token: access })
      }).then((r) => { if (!r.ok && r.status !== 404 && r.status !== 422) console.error("sign-out: revoke failed, status", r.status); })
        .catch(() => console.error("sign-out: revoke request failed")));
    }
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function me(request, env, url) {
  const session = await getSession(request, env);
  return privateJson({
    user: session ? { handle: session.handle, avatar_url: session.avatarUrl } : null,
    sign_in: signInConfigured(env) && url.origin === siteOrigin(env)
  });
}
