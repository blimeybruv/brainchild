// Local rig: runs api/worker.js in Miniflare against a stand-in for GitHub, GitLab.com, a self-hosted
// GitLab and Software Heritage. Used to reproduce the findings of the 16 Nov security review and to
// check the fixes (HANDOFF.md, "Security and privacy review, 16 Nov"). Nothing here is deployed.
//
// To run, in a scratch folder outside the repo (so no node_modules lands in it):
//   npm install miniflare
//   cp /path/to/repo/tests/review/*.mjs .
//   BC_ROOT=/path/to/repo node holes.mjs
import { Miniflare, Response } from "miniflare";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = process.env.BC_ROOT || fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const SITE = "https://brainchild.nexus";
const b64 = (s) => Buffer.from(s).toString("base64");

// ---------- the stand-in forges ----------
export const world = {
  gh: {
    users: {
      owner: { id: 1001, login: "owner" }, mod: { id: 9000, login: "mod" }, eve: { id: 1003, login: "eve" },
      "sample-ada": { id: 1004, login: "sample-ada" }, bob: { id: 1005, login: "bob" }
    },
    repos: {} // "owner/name" -> { id, admins: [login], private, spdx, licenseText, sha, fork, parent: {full_name,id} }
  },
  gl: { users: { glowner: { id: 2001, username: "glowner" } } },
  sh: { projects: {}, hang: false, huge: false }, // "group/proj" -> { id, verify, licenseText, sha }
  log: []
};
function ghRepo(full, login) {
  const r = world.gh.repos[full.toLowerCase()];
  if (!r) return null;
  const [o, n] = r.full_name.split("/");
  return {
    id: r.id, full_name: r.full_name, name: n, owner: { login: o }, html_url: "https://github.com/" + r.full_name, private: !!r.private,
    fork: !!r.fork, parent: r.parent || undefined, archived: false, default_branch: "main", license: r.spdx ? { spdx_id: r.spdx } : null,
    permissions: { admin: r.admins.includes(login), push: true, pull: true }
  };
}
const J = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function outbound(request) {
  const url = new URL(request.url);
  world.log.push(request.method + " " + url.href);
  const auth = request.headers.get("authorization") || "";
  const login = (auth.match(/^Bearer tok-g[hl]-(.+)$/) || [])[1] || null;
  if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") {
    const body = new URLSearchParams(await request.text());
    const who = (body.get("code") || body.get("refresh_token") || "").replace(/^(code|ref-gh)-/, "");
    if (!world.gh.users[who]) return J({ error: "bad_verification_code" });
    return J({ access_token: "tok-gh-" + who, expires_in: 28800, refresh_token: "ref-gh-" + who, refresh_token_expires_in: 15000000 });
  }
  if (url.hostname === "api.github.com") {
    const p = url.pathname;
    if (p === "/user") { const u = world.gh.users[login]; return u ? J({ ...u, created_at: "2020-01-01T00:00:00Z", public_repos: 3, public_gists: 0, email: "should-never-be-stored@example.com" }) : J({}, 401); }
    if (p === "/user/repos") return J([]);
    if (p.startsWith("/applications/")) return new Response(null, { status: 204 });
    let m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (m) {
      if (!world.gh.users[login]) return J({}, 401);
      const full = decodeURIComponent(m[1]) + "/" + decodeURIComponent(m[2]), r = world.gh.repos[full.toLowerCase()], rest = m[3] || "";
      if (!r) return J({ message: "Not Found" }, 404);
      if (!rest) return J(ghRepo(full, login));
      if (rest.startsWith("/commits/")) return J({ sha: r.sha });
      if (rest === "/license") return r.licenseText ? J({ content: b64(r.licenseText), encoding: "base64", path: "LICENSE", license: { spdx_id: r.spdx || "NOASSERTION" } }) : J({}, 404);
      if (rest.startsWith("/contents/")) return J({}, 404);
      return J({}, 404);
    }
    return J({}, 404);
  }
  if (url.hostname === "gitlab.com") {
    if (url.pathname === "/oauth/token") {
      const body = new URLSearchParams(await request.text());
      const who = (body.get("code") || body.get("refresh_token") || "").replace(/^(code|ref-gl)-/, "");
      if (!world.gl.users[who]) return J({ error: "invalid_grant" }, 400);
      return J({ access_token: "tok-gl-" + who, expires_in: 7200, refresh_token: "ref-gl-" + who });
    }
    if (url.pathname === "/oauth/revoke") return J({});
    if (url.pathname === "/api/v4/user") { const u = world.gl.users[login]; return u ? J({ ...u, state: "active", created_at: "2021-01-01T00:00:00Z", avatar_url: "https://secure.gravatar.com/avatar/abc", email: "never@example.com" }) : J({}, 401); }
    if (/^\/api\/v4\/users\/\d+\/projects$/.test(url.pathname)) return J([]);
    return J({}, 404);
  }
  if (url.hostname === "archive.softwareheritage.org") return J({ id: 77, save_request_status: "accepted", save_task_status: "not yet scheduled" });
  if (url.hostname === "git.selfhost.org") {
    if (world.sh.hang) return new Promise(() => {});
    if (world.sh.huge) {
      // An answer with no declared length that never stops.
      let sent = 0;
      world.sh.cancelled = false;
      const stream = new ReadableStream({
        async pull(c) { await new Promise((d) => setTimeout(d, 2)); sent += 65536; world.sh.sent = sent; if (sent > 1024 * 1024 * 1024) c.close(); else c.enqueue(new Uint8Array(65536).fill(32)); },
        cancel() { world.sh.cancelled = true; }
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    }
    const p = url.pathname.replace(/^\/api\/v4/, "");
    let m = p.match(/^\/projects\/([^/]+)$/);
    const byRef = (ref) => { ref = decodeURIComponent(ref); return /^\d+$/.test(ref) ? Object.values(world.sh.projects).find((x) => x.id === Number(ref)) : world.sh.projects[ref.toLowerCase()]; };
    if (m) {
      const pr = byRef(m[1]);
      if (!pr) return J({}, 404);
      return J({ id: pr.id, path_with_namespace: pr.path, path: pr.path.split("/").pop(), namespace: { full_path: pr.path.split("/").slice(0, -1).join("/") }, visibility: "public",
        default_branch: "main", archived: false, license: { key: "mit" }, web_url: "https://evil.example/" + pr.path, forked_from_project: pr.parent || undefined });
    }
    m = p.match(/^\/projects\/(\d+)\/repository\/(.+)$/);
    if (m) {
      const pr = byRef(m[1]);
      if (!pr) return J({}, 404);
      if (m[2].startsWith("files/brainchild-verify.txt/raw")) return pr.verify ? new Response(pr.verify) : J({}, 404);
      if (m[2].startsWith("tree")) return J([{ type: "blob", name: "LICENSE" }]);
      if (m[2].startsWith("commits/")) return J({ id: pr.sha });
      if (m[2].startsWith("files/LICENSE/raw")) return new Response(pr.licenseText);
      return J({}, 404);
    }
    return J({}, 404);
  }
  return J({ error: "no stand-in for " + url.hostname }, 502);
}

// ---------- the Worker ----------
export async function start(extra = {}) {
  const mf = new Miniflare({
    modules: true, modulesRoot: ROOT, scriptPath: ROOT + "/api/worker.js",
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2025-09-01",
    d1Databases: { DB: "rig-db" }, r2Buckets: { BUILDS: "rig-bucket" },
    bindings: { GITHUB_CLIENT_ID: "ghid", GITHUB_CLIENT_SECRET: "gh-secret-for-tests", GITLAB_CLIENT_ID: "glid", GITLAB_CLIENT_SECRET: "gl-secret", MODERATOR_GITHUB_IDS: "9000", ...extra },
    serviceBindings: { ASSETS: async () => new Response('<!doctype html><meta name="age-de-meta-label" content="age=0">', { headers: { "content-type": "text/html" } }) },
    outboundService: outbound
  });
  const db = await mf.getD1Database("DB");
  const sql = readFileSync(ROOT + "/db/schema.sql", "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  for (const st of sql.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(st).run();
  return { mf, db };
}

export class Client {
  constructor(mf, name) { this.mf = mf; this.name = name; this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => k + "=" + v).join("; "); }
  async req(method, path, { body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = this.cookieHeader();
    if (method !== "GET" && !("origin" in h)) h.origin = SITE;
    if (h.origin === null) delete h.origin;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await this.mf.dispatchFetch(SITE + path, { method, headers: h, body: payload, redirect: "manual" });
    for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = c.split(";"), i = pair.indexOf("="), k = pair.slice(0, i), v = pair.slice(i + 1);
      if (!v || /Max-Age=0/i.test(c)) this.jar.delete(k); else this.jar.set(k, v);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, headers: res.headers, text, data, location: res.headers.get("location") };
  }
  get(path, opts) { return this.req("GET", path, opts); }
  post(path, body, opts = {}) { return this.req("POST", path, { body, ...opts }); }
  async signIn(login, provider = "github", extraQuery = "", headers = {}) {
    const start = provider === "github" ? "/api/auth/login?provider=github&return_to=%2F" + extraQuery : "/api/auth/gitlab/login?return_to=%2F" + extraQuery;
    const a = await this.get(start, { headers });
    if (a.status !== 302 || !/oauth/.test(a.location || "")) return { started: false, first: a };
    const state = new URL(a.location).searchParams.get("state");
    const cb = (provider === "github" ? "/api/auth/callback" : "/api/auth/gitlab/callback") + "?code=code-" + login + "&state=" + state;
    const b = await this.get(cb);
    return { started: true, first: a, last: b };
  }
  async me() { return (await this.get("/api/me")).data.user; }
}

export function repo(full, o = {}) {
  world.gh.repos[full.toLowerCase()] = { full_name: full, id: o.id, admins: o.admins || [full.split("/")[0]], spdx: "spdx" in o ? o.spdx : "MIT", licenseText: "licenseText" in o ? o.licenseText : "MIT License\n\nCopyright (c) 2026 " + full + "\n",
    sha: o.sha || "a".repeat(40), fork: !!o.parent, parent: o.parent || null, private: !!o.private };
}
export const listing = (repoName, o = {}) => ({
  host: "github", repo: repoName, intent: "stay", status: "help", title: "Test Game", kind: "Game", genre: "Puzzle", tech: "JS", browser: false, note: "A test game.",
  rating: "everyone", content_notes: [], assets_license: "Same as the code", works: "It runs.", agreed: true, ...o
});

// ---------- tiny reporter ----------
let failed = 0;
export function check(label, ok, detail = "") {
  if (!ok) failed++;
  console.log((ok ? "  ok    " : "  FAIL  ") + label + (detail ? "   [" + detail + "]" : ""));
}
export function section(t) { console.log("\n" + t); }
export function done() { console.log("\n" + (failed ? failed + " check(s) FAILED" : "all checks passed")); return failed; }
