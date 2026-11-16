// Signals for moderators about vote rigging (HANDOFF.md, "vote-rigging signals and a privacy page").
//
//   - Cheap signals: how old the Brainchild account is, how old the linked GitHub or GitLab account
//     is, and whether that account has any public repositories or projects.
//   - A network flag for blog votes, Relay entries and Relay rankings only: a keyed hash (HMAC) of the
//     requester's network, the IPv4 /24 or IPv6 /64 from CF-Connecting-IP. The address itself is never
//     stored. The key is derived per vote or round, so the same network gives different hashes in
//     different votes, and nothing can be followed across them. Rows are deleted 30 days after the
//     vote or round closes.
//   - Moderators see only counts ("3 votes in this vote came from one network") and the cheap signals,
//     never addresses or hashes. A signal means "worth a look"; nothing is ever penalised automatically.

import { b64urlEncode } from "./http.js";

const NEW_ACCOUNT_DAYS = 14, NEW_LINKED_DAYS = 30;

// The network part of an address: a.b.c for IPv4, the first four groups for IPv6. null if unusable.
export function networkOf(ip) {
  if (typeof ip !== "string") return null;
  ip = ip.trim();
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return v4.slice(1, 4).map(Number).every((n) => n <= 255) ? "4:" + v4.slice(1, 4).join(".") : null;
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return null;
  // Expand "::" so the first four groups are always the /64.
  const [head, tail] = ip.toLowerCase().split("::");
  const a = head ? head.split(":") : [], b = tail !== undefined && tail ? tail.split(":") : [];
  if (ip.split("::").length > 2) return null;
  const groups = tail === undefined ? a : a.concat(Array(Math.max(0, 8 - a.length - b.length)).fill("0"), b);
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return "6:" + groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

let keyCache = new Map();
async function scopeKey(env, scope) {
  const secret = (typeof env.GITHUB_CLIENT_SECRET === "string" && env.GITHUB_CLIENT_SECRET.trim()) || (typeof env.GITLAB_CLIENT_SECRET === "string" && env.GITLAB_CLIENT_SECRET.trim()) || "";
  const id = secret + "|" + scope;
  if (keyCache.has(id)) return keyCache.get(id);
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("brainchild.nexus net-flag"), info: enc.encode(scope) },
    material, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  if (keyCache.size > 50) keyCache = new Map();
  keyCache.set(id, key);
  return key;
}

function plusDays(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The statement that records (or replaces) one person's network flag for a vote or round, or null
// when the address can't be read. closes: the YYYY-MM-DD the vote or round's voting closes.
export async function flagStatement(env, request, kind, scope, userId, closes) {
  const net = networkOf(request.headers.get("cf-connecting-ip"));
  if (!net) return null;
  const sig = await crypto.subtle.sign("HMAC", await scopeKey(env, kind.startsWith("relay") ? "relay|" + scope : "vote|" + scope), new TextEncoder().encode(net));
  return env.DB.prepare(
    "INSERT INTO net_flags (kind, scope, user_id, net_hash, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, scope, user_id) DO UPDATE SET net_hash = excluded.net_hash, expires_at = excluded.expires_at"
  ).bind(kind, scope, userId, b64urlEncode(new Uint8Array(sig)).slice(0, 22), plusDays(closes, 30));
}

// Records a flag, never failing the action it accompanies.
export async function recordFlag(env, request, kind, scope, userId, closes) {
  try {
    const st = await flagStatement(env, request, kind, scope, userId, closes);
    if (st) await st.run();
  } catch (e) { console.error("signals: could not record a flag"); }
}

// Deletes network codes past their date and sign-in sessions that have run out, so the retention
// times on the privacy page hold without waiting for a moderator to open the queue or for the next
// sign-in. It runs when any page asks who is signed in, at most once every ten minutes per running
// copy of the Worker; nothing here runs on a timer.
let lastSweep = 0;
export async function sweepExpired(env, force = false) {
  const now = Date.now();
  if (!force && now - lastSweep < 10 * 60 * 1000) return;
  lastSweep = now;
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM net_flags WHERE expires_at < ?").bind(new Date(now).toISOString().slice(0, 10)),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Math.floor(now / 1000))
    ]);
  } catch { console.error("signals: could not delete expired rows"); }
}

const daysSince = (t) => (t ? Math.floor((Date.now() - new Date(String(t).replace(" ", "T") + (String(t).endsWith("Z") ? "" : "Z")).getTime()) / 86400000) : null);

// For the moderation queue: shared networks (counts only) and new or empty accounts that voted or entered.
export async function moderatorSignals(env) {
  await sweepExpired(env, true);
  const { results: shared } = await env.DB.prepare(
    "SELECT kind, scope, COUNT(*) AS n FROM net_flags GROUP BY kind, scope, net_hash HAVING COUNT(*) >= 2 ORDER BY scope DESC, n DESC LIMIT 50"
  ).all();
  // Everyone who has a flag still on record took part recently; look at their accounts.
  const { results: people } = await env.DB.prepare(
    `SELECT f.kind, f.scope, u.handle, u.created_at,
            (SELECT json_group_array(json_object('provider', i.provider, 'created', i.provider_created_at, 'activity', i.public_activity)) FROM identities i WHERE i.user_id = u.id) AS ids
       FROM net_flags f JOIN users u ON u.id = f.user_id ORDER BY f.scope DESC LIMIT 500`
  ).all();
  const fresh = [];
  for (const p of people) {
    let ids = [];
    try { ids = JSON.parse(p.ids || "[]"); } catch { ids = []; }
    const age = daysSince(p.created_at);
    const linked = ids.map((i) => ({ provider: i.provider, age_days: daysSince(i.created), public_activity: i.activity === null || i.activity === undefined ? null : !!i.activity }));
    const why = [];
    if (age !== null && age < NEW_ACCOUNT_DAYS) why.push("new_account");
    if (linked.some((l) => l.age_days !== null && l.age_days < NEW_LINKED_DAYS)) why.push("new_linked_account");
    if (linked.length && linked.every((l) => l.public_activity === false)) why.push("no_public_activity");
    if (why.length) fresh.push({ kind: p.kind, scope: p.scope, handle: p.handle, account_age_days: age, linked, why });
  }
  return { shared_networks: shared.map((s) => ({ kind: s.kind, scope: s.scope, count: s.n })), accounts: fresh.slice(0, 100) };
}
