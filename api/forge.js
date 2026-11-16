// The code hosts a project can live on: GitHub and GitLab.com. Every question the listing,
// editing, adoption, build and screenshot routes ask about a repository goes through here,
// so the same rules apply on both:
//
//   - Only someone who manages the repository may list it or change its listing: on GitHub an
//     admin (permissions.admin), on GitLab a Maintainer or Owner (access level 40 or 50, inherited
//     group membership included). It is asked with that person's own token at the moment of the
//     change, never from an earlier answer.
//   - Only public repositories can be listed.
//   - A repo is identified by (host, the host's numeric id), so a rename or transfer keeps it.
//   - Codeberg isn't supported (owner's decision, 14 Nov).
//   - Self-hosted GitLab (host "selfhosted:<hostname>"): Brainchild can't sign in there, so the person
//     proves push access by committing a code Brainchild gave them to brainchild-verify.txt in the
//     default branch. The instance's public API is read without any token. Those listings are labelled
//     "verified: push access". Only https, ordinary public host names, size-capped answers.
//
// A repo, as the rest of the code sees it:
//   { host, id, full_name, owner, name, url, private, fork, parent, parent_id, archived, default_branch, license }

import { privateJson, nowSeconds, randomToken } from "./http.js";
import { githubGet, repoAccess as githubAccess } from "./github.js";
import { gitlabGet, gitlabRaw } from "./gitlab.js";

export const HOSTS = ["github", "gitlab", "selfhosted"];
const WEB = { github: "https://github.com/", gitlab: "https://gitlab.com/" };
export const VERIFY_FILE = "brainchild-verify.txt";
const CODE_DAYS = 7;          // a code must be committed within a week of being issued
const MAX_JSON_BYTES = 512 * 1024;
export const isSelfHosted = (host) => typeof host === "string" && host.startsWith("selfhosted:");
const gitlabLike = (host) => host === "gitlab" || isSelfHosted(host);
const instance = (host) => host.slice("selfhosted:".length);
// A self-hosted instance's API. Tests point this at a local stand-in.
function instanceApi(env, host) {
  return (env.SELFHOSTED_BASE ? env.SELFHOSTED_BASE.replace(/\/$/, "") + "/" + instance(host) : "https://" + instance(host)) + "/api/v4";
}
// An ordinary public host name: letters, digits, dots and hyphens, a real top-level domain, no IP address.
export function publicHostname(h) {
  return typeof h === "string" && h.length <= 253 && /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)
    && !/^\d+(\.\d+){3}$/.test(h) && !/(^|\.)(localhost|local|internal|lan|home|corp|localdomain|example|invalid|test)$/.test(h)
    && !["github.com", "gitlab.com", "codeberg.org", "brainchild.nexus", "brainwave.nexus", "workers.dev", "pages.dev", "r2.dev"].some((x) => h === x || h.endsWith("." + x));
}

// A self-hosted instance is somebody else's server, so it gets a deadline, and its answer is read only
// up to the size limit: reading stops there instead of taking in whatever it sends.
const INSTANCE_TIMEOUT_MS = 8000;
function instanceFetch(env, host, path, headers) {
  return fetch(instanceApi(env, host) + path, { headers: { "user-agent": "brainchild.nexus", ...headers }, redirect: "manual", signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS) });
}
function drop(res) { try { if (res.body) res.body.cancel().catch(() => {}); } catch { /* nothing to drop */ } }
// The body as bytes, or null when it is larger than maxBytes.
async function readCapped(res, maxBytes) {
  if (Number(res.headers.get("content-length") || 0) > maxBytes) { drop(res); return null; }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// GET from GitLab.com (with the person's token) or a self-hosted instance (no token): { status, data } or { reauth: true }.
async function glGet(env, session, host, path) {
  if (host === "gitlab") return gitlabGet(env, session, path);
  try {
    const res = await instanceFetch(env, host, path, { accept: "application/json" });
    if (res.status !== 200) { drop(res); return { status: res.status === 401 || res.status === 403 ? 404 : res.status, data: null }; }
    const bytes = await readCapped(res, MAX_JSON_BYTES);
    if (!bytes) return { status: 502, data: null };
    try { return { status: 200, data: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { status: 502, data: null }; }
  } catch { return { status: 502, data: null }; }
}
async function glRaw(env, session, host, path, maxBytes) {
  if (host === "gitlab") return gitlabRaw(env, session, path, maxBytes);
  try {
    const res = await instanceFetch(env, host, path, {});
    if (res.status !== 200) { drop(res); return { status: res.status }; }
    const bytes = await readCapped(res, maxBytes);
    return bytes ? { status: 200, bytes } : { tooLarge: true };
  } catch { return { status: 502 }; }
}
const MAX_LICENSE_BYTES = 200 * 1024;
const MAINTAINER = 40; // GitLab: 40 Maintainer, 50 Owner

export function repoUrl(host, fullName) { return (isSelfHosted(host) ? "https://" + instance(host) + "/" : WEB[host] || WEB.github) + fullName; }
export function hostName(host) { return host === "gitlab" ? "GitLab" : isSelfHosted(host) ? instance(host) : "GitHub"; }
const reauth = (host) => (host === "gitlab" ? "gitlab_sign_in_again" : isSelfHosted(host) ? "selfhosted_unreachable" : "github_sign_in_again");

// What someone typed or picked: "owner/name" or a github.com address for GitHub; a project id,
// "group/sub/name" or a gitlab.com address for GitLab. Returns { host, ref } or { error }.
export function parseRepoRef(host, raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return { error: "bad_repo_name" };
  let v = String(raw).trim();
  if (/^(https?:\/\/)?(www\.)?codeberg\.org\b/i.test(v)) return { error: "codeberg_not_supported" };
  if (host === "selfhosted" || isSelfHosted(host)) {
    // A full https address on the person's own GitLab: https://git.example.org/group/project
    const m = v.match(/^https:\/\/([^/?#:@]+)\/([^?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i);
    if (!m) return { error: "selfhosted_address" };
    const hostname = m[1].toLowerCase(), path = m[2].replace(/\/-\/.*$/, "");
    if (/^(www\.)?(github|gitlab)\.com$/.test(hostname)) return parseRepoRef(hostname.includes("gitlab") ? "gitlab" : "github", v);
    if (!publicHostname(hostname)) return { error: "selfhosted_address" };
    if (!/^[A-Za-z0-9_.-]{1,100}(\/[A-Za-z0-9_.-]{1,100}){1,5}$/.test(path) || path.split("/").some((x) => x === "." || x === "..")) return { error: "selfhosted_address" };
    if (isSelfHosted(host) && instance(host) !== hostname) return { error: "wrong_host" };
    return { host: "selfhosted:" + hostname, ref: path };
  }
  if (/^(https?:\/\/)?(www\.)?gitlab\.com\//i.test(v)) host = "gitlab";
  else if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(v)) host = "github";
  else if (/^https?:\/\//i.test(v)) return { error: host === "gitlab" ? "gitlab_com_only" : "bad_repo_name" };
  v = v.replace(/^(https?:\/\/)?(www\.)?(github|gitlab)\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "").replace(/\/-\/.*$/, "");
  if (host === "gitlab") {
    if (/^\d{1,12}$/.test(v)) return { host, ref: v };
    if (/^[A-Za-z0-9_.-]{1,100}(\/[A-Za-z0-9_.-]{1,100}){1,5}$/.test(v) && !v.split("/").some((s) => s === "." || s === "..")) return { host, ref: v };
    return { error: "bad_repo_name" };
  }
  const m = v.match(/^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/);
  if (!m || [m[1], m[2]].some((s) => s === "." || s === "..")) return { error: "bad_repo_name" };
  return { host: "github", ref: m[1] + "/" + m[2] };
}

// GitLab names licenses with lower-case keys; Brainchild stores SPDX ids.
const GITLAB_LICENSES = {
  "mit": "MIT", "apache-2.0": "Apache-2.0", "gpl-3.0": "GPL-3.0", "gpl-2.0": "GPL-2.0", "lgpl-3.0": "LGPL-3.0", "lgpl-2.1": "LGPL-2.1",
  "agpl-3.0": "AGPL-3.0", "mpl-2.0": "MPL-2.0", "bsd-2-clause": "BSD-2-Clause", "bsd-3-clause": "BSD-3-Clause", "isc": "ISC",
  "unlicense": "Unlicense", "cc0-1.0": "CC0-1.0", "epl-2.0": "EPL-2.0", "bsl-1.0": "BSL-1.0", "zlib": "Zlib", "0bsd": "0BSD",
  "cc-by-4.0": "CC-BY-4.0", "cc-by-sa-4.0": "CC-BY-SA-4.0", "eupl-1.2": "EUPL-1.2", "mit-0": "MIT-0", "wtfpl": "WTFPL"
};
function gitlabSpdx(key) { return typeof key === "string" ? GITLAB_LICENSES[key.toLowerCase()] || null : null; }

function gitlabRepo(d) {
  const f = d.forked_from_project;
  const url = typeof d.web_url === "string" && /^https:\/\/gitlab\.com\//.test(d.web_url) ? d.web_url : repoUrl("gitlab", d.path_with_namespace);
  return {
    host: "gitlab", id: d.id, full_name: d.path_with_namespace,
    owner: d.namespace && typeof d.namespace.full_path === "string" ? d.namespace.full_path : null,
    name: typeof d.path === "string" ? d.path : null, url,
    private: d.visibility !== "public", fork: !!f,
    parent: f && typeof f.path_with_namespace === "string" ? f.path_with_namespace : null,
    parent_id: f && Number.isSafeInteger(f.id) ? f.id : null,
    archived: d.archived === true,
    default_branch: typeof d.default_branch === "string" && d.default_branch ? d.default_branch : null,
    license: d.license ? gitlabSpdx(d.license.key) : null
  };
}

// Looks a repository up as the signed-in person. { ok: true, admin, repo } or { ok: false, error, status }.
export async function access(env, session, host, ref, opts = {}) {
  if (isSelfHosted(host)) return selfHostedAccess(env, session, host, ref, opts);
  if (host !== "gitlab") {
    const [owner, name] = String(ref).split("/");
    const r = await githubAccess(env, session, owner, name);
    if (r.ok) r.repo.host = "github";
    return r;
  }
  if (!session || !session.gitlabId) return { ok: false, error: "gitlab_sign_in_again", status: 401 };
  const r = await gitlabGet(env, session, "/projects/" + encodeURIComponent(ref) + "?license=true");
  if (r.reauth) return { ok: false, error: "gitlab_sign_in_again", status: 401 };
  if (r.status === 404) return { ok: false, error: "repo_not_found", status: 404 };
  const d = r.data;
  if (r.status !== 200 || !d || !Number.isSafeInteger(d.id) || typeof d.path_with_namespace !== "string" || !/^[A-Za-z0-9_.\/-]{3,400}$/.test(d.path_with_namespace)) {
    console.error("gitlab: project lookup failed, status", r.status);
    return { ok: false, error: "gitlab_error", status: 502 };
  }
  // The person's role, counting roles inherited from groups. 404 = not a member at all.
  const m = await gitlabGet(env, session, "/projects/" + d.id + "/members/all/" + session.gitlabId);
  if (m.reauth) return { ok: false, error: "gitlab_sign_in_again", status: 401 };
  if (m.status !== 200 && m.status !== 404) return { ok: false, error: "gitlab_error", status: 502 };
  const level = m.status === 200 && m.data && Number.isSafeInteger(m.data.access_level) && m.data.state !== "blocked" ? m.data.access_level : 0;
  return { ok: true, admin: level >= MAINTAINER, repo: gitlabRepo(d) };
}

// For routes that create or change a listing: { repo } when the person manages a public repo, else { response }.
// opts.fresh: on a self-hosted instance, the file must hold a new, unused code (listing, handoff, adoption).
export async function requireAdmin(env, session, host, ref, opts = {}) {
  if (!session) return { response: privateJson({ error: "not_signed_in" }, 401) };
  const r = await access(env, session, host, ref, opts);
  if (!r.ok) return { response: privateJson({ error: r.error }, r.status) };
  if (r.repo.private) return { response: privateJson({ error: "repo_not_public" }, 403) };
  if (!r.admin) return { response: privateJson({ error: r.verifyError || "not_repo_admin" }, 403) };
  return { repo: r.repo, code: r.code || null }; // code: the self-hosted verification code that was found
}

// ---------- self-hosted GitLab: the verification file ----------

// POST /api/verify-code  { url } : a code to commit to brainchild-verify.txt in that repository.
export async function issueCode(request, env, session) {
  if (!session) return privateJson({ error: "not_signed_in" }, 401);
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  const parsed = parseRepoRef("selfhosted", body && body.url);
  if (parsed.error) return privateJson({ error: parsed.error }, 400);
  if (!isSelfHosted(parsed.host)) return privateJson({ error: "not_selfhosted" }, 400); // GitHub and GitLab.com use sign-in instead
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM verify_codes WHERE user_id = ? AND created_at > ?").bind(session.userId, nowSeconds() - 86400).first();
  if (today.n >= 20) return privateJson({ error: "slow_down" }, 429);
  const code = "brainchild-" + randomToken(18);
  await env.DB.prepare("INSERT INTO verify_codes (code, user_id, repo_host, repo_path, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(code, session.userId, parsed.host, parsed.ref.toLowerCase(), nowSeconds()).run();
  return privateJson({ ok: true, code, file: VERIFY_FILE, host: parsed.host, path: parsed.ref, days: CODE_DAYS });
}

// Reads brainchild-verify.txt at the head of the default branch and checks it holds a code issued to
// this person for this repository. fresh: the code must be unused and issued within CODE_DAYS.
async function checkFile(env, session, host, repo, fresh) {
  if (!session || !repo.default_branch) return { ok: false, error: "verify_file_missing" };
  const raw = await glRaw(env, session, host, "/projects/" + repo.id + "/repository/files/" + VERIFY_FILE + "/raw?ref=" + encodeURIComponent(repo.default_branch), 2048);
  if (raw.status !== 200 || !raw.bytes) return { ok: false, error: "verify_file_missing" };
  const text = new TextDecoder().decode(raw.bytes).trim();
  const m = text.match(/brainchild-[A-Za-z0-9_-]{24}/);
  if (!m) return { ok: false, error: "verify_file_missing" };
  const row = await env.DB.prepare("SELECT code, created_at, used_at FROM verify_codes WHERE code = ? AND user_id = ? AND repo_host = ? AND repo_path = ?")
    .bind(m[0], session.userId, host, repo.full_name.toLowerCase()).first();
  if (!row) return { ok: false, error: "verify_code_not_yours" };
  if (fresh && (row.used_at || row.created_at < nowSeconds() - CODE_DAYS * 86400)) return { ok: false, error: "verify_code_stale" };
  return { ok: true, code: row.code };
}

// Marks a code used, so the next listing, handoff or adoption needs a new one.
export function useCode(env, code) {
  return env.DB.prepare("UPDATE verify_codes SET used_at = ? WHERE code = ? AND used_at IS NULL").bind(nowSeconds(), code);
}

async function selfHostedAccess(env, session, host, ref, opts) {
  const r = await glGet(env, session, host, "/projects/" + encodeURIComponent(ref) + "?license=true");
  if (r.status === 404) return { ok: false, error: "repo_not_found", status: 404 };
  const d = r.data;
  if (r.status !== 200 || !d || !Number.isSafeInteger(d.id) || typeof d.path_with_namespace !== "string" || !/^[A-Za-z0-9_.\/-]{3,400}$/.test(d.path_with_namespace)) {
    return { ok: false, error: "selfhosted_unreachable", status: 502 };
  }
  const repo = gitlabRepo(d);
  repo.host = host;
  repo.url = repoUrl(host, d.path_with_namespace); // never a link the instance chose
  const check = await checkFile(env, session, host, repo, !!opts.fresh);
  return { ok: true, admin: check.ok, verifyError: check.ok ? null : check.error, code: check.code || null, repo, verification: "push" };
}

// The same check for a listed project (a row with repo_host, repo_id and repo_full_name).
export async function requireProjectAdmin(env, session, p) {
  const host = p.repo_host || "github";
  const r = await requireAdmin(env, session, host, host === "gitlab" ? String(p.repo_id) : p.repo_full_name);
  // GitHub and self-hosted GitLab are asked by name, and a name can pass to a different repository
  // (the listed one is renamed or transferred, and a new one is created under the old name). Managing
  // that other repository proves nothing about the listed one, so the host's permanent id must match.
  if (r.repo && p.repo_id !== null && p.repo_id !== undefined && r.repo.id !== p.repo_id) {
    return { response: privateJson({ error: "repo_changed" }, 409) };
  }
  return r;
}

// The latest commit on a branch: { sha } or { error, status }.
export async function headCommit(env, session, repo) {
  const gl = gitlabLike(repo.host);
  const r = gl
    ? await glGet(env, session, repo.host, "/projects/" + repo.id + "/repository/commits/" + encodeURIComponent(repo.default_branch))
    : await githubGet(env, session, "/repos/" + repo.full_name + "/commits/" + encodeURIComponent(repo.default_branch));
  if (r.reauth) return { error: reauth(repo.host), status: 401 };
  const sha = r.status === 200 && r.data && typeof (gl ? r.data.id : r.data.sha) === "string" ? (gl ? r.data.id : r.data.sha) : null;
  return sha && /^[0-9a-f]{40}$/.test(sha) ? { sha } : { error: "no_commits", status: 409 };
}

async function fingerprint(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}
function fromBase64(text) {
  const bin = atob(text.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// The license file in the repo at a commit: { license: { spdx, path, bytes, sha256 } }, { license: null } or { error, status }.
// spdx null means a license file the host doesn't recognise as a standard one.
export async function fetchLicense(env, session, repo, ref) {
  let bytes, spdx, path;
  if (gitlabLike(repo.host)) {
    // GitLab detects the license on the default branch; the text is read at the exact commit.
    const t = await glGet(env, session, repo.host, "/projects/" + repo.id + "/repository/tree?per_page=100&ref=" + encodeURIComponent(ref || repo.default_branch));
    if (t.reauth) return { error: "gitlab_sign_in_again", status: 401 };
    if (t.status !== 200 || !Array.isArray(t.data)) return t.status === 404 ? { license: null } : { error: repo.host === "gitlab" ? "gitlab_error" : "selfhosted_unreachable", status: 502 };
    const file = t.data.find((x) => x && x.type === "blob" && typeof x.name === "string" && /^(LICEN[CS]E|COPYING)(\.(md|txt|rst))?$/i.test(x.name));
    if (!file) return { license: null };
    const raw = await glRaw(env, session, repo.host, "/projects/" + repo.id + "/repository/files/" + encodeURIComponent(file.name) + "/raw?ref=" + encodeURIComponent(ref || repo.default_branch), MAX_LICENSE_BYTES);
    if (raw.reauth) return { error: "gitlab_sign_in_again", status: 401 };
    if (raw.tooLarge) return { error: "license_too_large", status: 409 };
    if (raw.status !== 200 || !raw.bytes) return { error: repo.host === "gitlab" ? "gitlab_error" : "selfhosted_unreachable", status: 502 };
    bytes = raw.bytes; path = file.name; spdx = repo.license;
  } else {
    const r = await githubGet(env, session, "/repos/" + repo.full_name + "/license" + (ref ? "?ref=" + encodeURIComponent(ref) : ""));
    if (r.reauth) return { error: "github_sign_in_again", status: 401 };
    if (r.status === 404) return { license: null };
    const d = r.data;
    if (r.status !== 200 || !d || typeof d.content !== "string") return { error: "github_error", status: 502 };
    try { bytes = fromBase64(d.content); } catch { return { error: "github_error", status: 502 }; }
    spdx = d.license && typeof d.license.spdx_id === "string" && d.license.spdx_id !== "NOASSERTION" ? d.license.spdx_id : null;
    path = typeof d.path === "string" && d.path.length <= 200 ? d.path : "LICENSE";
  }
  if (!bytes.length) return { license: null };
  if (bytes.length > MAX_LICENSE_BYTES) return { error: "license_too_large", status: 409 };
  if (spdx && !/^[A-Za-z0-9.+-]{1,60}$/.test(spdx)) spdx = null;
  return { license: { spdx, path, bytes, sha256: await fingerprint(bytes) } };
}

// The repo's CLAUDE.md or AGENTS.md, to prefill the packet: { path, text } or null.
export async function fetchAgentFile(env, session, repo) {
  for (const path of ["CLAUDE.md", "AGENTS.md"]) {
    if (gitlabLike(repo.host)) {
      if (!repo.default_branch) return null;
      const raw = await glRaw(env, session, repo.host, "/projects/" + repo.id + "/repository/files/" + path + "/raw?ref=" + encodeURIComponent(repo.default_branch), 200 * 1024);
      if (raw.reauth) return null;
      if (raw.status === 200 && raw.bytes) {
        const body = new TextDecoder().decode(raw.bytes);
        if (body.trim()) return { path, text: body.slice(0, 20000) };
      }
      continue;
    }
    const r = await githubGet(env, session, "/repos/" + repo.full_name + "/contents/" + path);
    if (r.reauth) return null;
    if (r.status === 200 && r.data && typeof r.data.content === "string" && r.data.encoding === "base64") {
      try {
        const body = new TextDecoder().decode(fromBase64(r.data.content));
        if (body.trim()) return { path, text: body.slice(0, 20000) };
      } catch { /* try the next file */ }
    }
  }
  return null;
}

// The person's public repositories, for the picker: [{ id, full_name, description, admin, fork, archived }] or { error, status }.
export async function listRepos(env, session, host) {
  if (host === "selfhosted") return { repos: [] }; // nothing to ask: the person types the address
  if (host === "gitlab") {
    if (!session.gitlabId) return { error: "gitlab_sign_in_again", status: 401 };
    const r = await gitlabGet(env, session, "/projects?membership=true&min_access_level=" + MAINTAINER + "&visibility=public&order_by=last_activity_at&per_page=100");
    if (r.reauth) return { error: "gitlab_sign_in_again", status: 401 };
    if (r.status !== 200 || !Array.isArray(r.data)) return { error: "gitlab_error", status: 502 };
    return { repos: r.data.filter((d) => d && Number.isSafeInteger(d.id) && typeof d.path_with_namespace === "string" && d.visibility === "public").slice(0, 100).map((d) => ({
      id: d.id, full_name: d.path_with_namespace, description: typeof d.description === "string" ? d.description.slice(0, 200) : "",
      admin: true, fork: !!d.forked_from_project, archived: d.archived === true
    })) };
  }
  const r = await githubGet(env, session, "/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100");
  if (r.reauth) return { error: "github_sign_in_again", status: 401 };
  if (r.status !== 200 || !Array.isArray(r.data)) return { error: "github_error", status: 502 };
  return { repos: r.data.filter((d) => d && Number.isSafeInteger(d.id) && typeof d.full_name === "string" && d.private !== true).slice(0, 100).map((d) => ({
    id: d.id, full_name: d.full_name, description: typeof d.description === "string" ? d.description.slice(0, 200) : "",
    admin: !!(d.permissions && d.permissions.admin === true), fork: d.fork === true, archived: d.archived === true
  })) };
}
