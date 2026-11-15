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
//
// A repo, as the rest of the code sees it:
//   { host, id, full_name, owner, name, url, private, fork, parent, parent_id, archived, default_branch, license }

import { privateJson } from "./http.js";
import { githubGet, repoAccess as githubAccess } from "./github.js";
import { gitlabGet, gitlabRaw } from "./gitlab.js";

export const HOSTS = ["github", "gitlab"];
const WEB = { github: "https://github.com/", gitlab: "https://gitlab.com/" };
const MAX_LICENSE_BYTES = 200 * 1024;
const MAINTAINER = 40; // GitLab: 40 Maintainer, 50 Owner

export function repoUrl(host, fullName) { return (WEB[host] || WEB.github) + fullName; }
export function hostName(host) { return host === "gitlab" ? "GitLab" : "GitHub"; }
const reauth = (host) => (host === "gitlab" ? "gitlab_sign_in_again" : "github_sign_in_again");

// What someone typed or picked: "owner/name" or a github.com address for GitHub; a project id,
// "group/sub/name" or a gitlab.com address for GitLab. Returns { host, ref } or { error }.
export function parseRepoRef(host, raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return { error: "bad_repo_name" };
  let v = String(raw).trim();
  if (/^(https?:\/\/)?(www\.)?codeberg\.org\b/i.test(v)) return { error: "codeberg_not_supported" };
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
export async function access(env, session, host, ref) {
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
export async function requireAdmin(env, session, host, ref) {
  if (!session) return { response: privateJson({ error: "not_signed_in" }, 401) };
  const r = await access(env, session, host, ref);
  if (!r.ok) return { response: privateJson({ error: r.error }, r.status) };
  if (r.repo.private) return { response: privateJson({ error: "repo_not_public" }, 403) };
  if (!r.admin) return { response: privateJson({ error: "not_repo_admin" }, 403) };
  return { repo: r.repo };
}

// The same check for a listed project (a row with repo_host, repo_id and repo_full_name).
export async function requireProjectAdmin(env, session, p) {
  const host = p.repo_host || "github";
  return requireAdmin(env, session, host, host === "gitlab" ? String(p.repo_id) : p.repo_full_name);
}

// The latest commit on a branch: { sha } or { error, status }.
export async function headCommit(env, session, repo) {
  const r = repo.host === "gitlab"
    ? await gitlabGet(env, session, "/projects/" + repo.id + "/repository/commits/" + encodeURIComponent(repo.default_branch))
    : await githubGet(env, session, "/repos/" + repo.full_name + "/commits/" + encodeURIComponent(repo.default_branch));
  if (r.reauth) return { error: reauth(repo.host), status: 401 };
  const sha = r.status === 200 && r.data && typeof (repo.host === "gitlab" ? r.data.id : r.data.sha) === "string" ? (repo.host === "gitlab" ? r.data.id : r.data.sha) : null;
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
  if (repo.host === "gitlab") {
    // GitLab detects the license on the default branch; the text is read at the exact commit.
    const t = await gitlabGet(env, session, "/projects/" + repo.id + "/repository/tree?per_page=100&ref=" + encodeURIComponent(ref || repo.default_branch));
    if (t.reauth) return { error: "gitlab_sign_in_again", status: 401 };
    if (t.status !== 200 || !Array.isArray(t.data)) return t.status === 404 ? { license: null } : { error: "gitlab_error", status: 502 };
    const file = t.data.find((x) => x && x.type === "blob" && typeof x.name === "string" && /^(LICEN[CS]E|COPYING)(\.(md|txt|rst))?$/i.test(x.name));
    if (!file) return { license: null };
    const raw = await gitlabRaw(env, session, "/projects/" + repo.id + "/repository/files/" + encodeURIComponent(file.name) + "/raw?ref=" + encodeURIComponent(ref || repo.default_branch), MAX_LICENSE_BYTES);
    if (raw.reauth) return { error: "gitlab_sign_in_again", status: 401 };
    if (raw.tooLarge) return { error: "license_too_large", status: 409 };
    if (raw.status !== 200 || !raw.bytes) return { error: "gitlab_error", status: 502 };
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
    if (repo.host === "gitlab") {
      if (!repo.default_branch) return null;
      const raw = await gitlabRaw(env, session, "/projects/" + repo.id + "/repository/files/" + path + "/raw?ref=" + encodeURIComponent(repo.default_branch), 200 * 1024);
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
