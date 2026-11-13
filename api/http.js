// Small shared helpers for the Worker: JSON responses, cookies, random ids, hashing.

export const DEFAULT_SITE_ORIGIN = "https://brainchild.nexus";

// The one address sign-in works on (it must match the callback URL registered with GitHub).
export function siteOrigin(env) {
  return (env && env.SITE_ORIGIN) || DEFAULT_SITE_ORIGIN;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  // Browsers always ask again (so people see their own changes at once); Cloudflare's edge
  // keeps a copy for 60 seconds to save database reads.
  "cache-control": "public, max-age=0, s-maxage=60"
};

export const NO_STORE = { "cache-control": "no-store" };

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

// Anything that depends on who is asking must never be cached.
export function privateJson(data, status = 200) {
  return json(data, status, NO_STORE);
}

export function redirect(location, cookies = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

export function parseCookies(request) {
  const out = {};
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

// HttpOnly: page scripts can't read it. Secure: HTTPS only. SameSite=Lax: not sent on
// cross-site POSTs. The "__Host-" name prefix (used by callers) also stops other
// subdomains from setting or overwriting it.
export function cookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// For requests that change something: the browser must say the request came from this site.
export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function b64urlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomToken(byteLength = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function sha256Hex(text) {
  const bytes = await sha256(text);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// Compare two secrets without leaking, through timing, how much of them matched.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
