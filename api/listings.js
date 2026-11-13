// Listing a project, the license snapshot kept with it, and adopting a project.
//
// Rules encoded here (see HANDOFF.md):
//   - Only an admin of a public GitHub repo can list it. The check is repeated at the moment
//     of publishing and again at the moment of adoption (requireRepoAdmin).
//   - A listing needs a license. Without one nobody may legally continue the project.
//   - Every release is recorded with its commit, license id and a fingerprint of the license
//     text, and a copy of that text is kept. Records are only ever added, never changed:
//     a release made under an earlier license can't be taken back.
//   - Adopters may relicense permissive code. GPL-family code stays under the same license.
//   - Apache-2.0 grants no name or trademark rights, so the maker's name rule is what applies.
//   - A mod's license covers only the modder's files, and mods must name their base game.
//   - Credit is never removed from lineage: adoption closes the old entry and adds a new one.

import { json, privateJson, NO_STORE, isSameOrigin } from "./http.js";
import { githubGet, repoAccess, requireRepoAdmin } from "./github.js";

const GENRES = ["Puzzle", "Platformer", "Racing", "Roguelite", "Narrative", "Sandbox", "Simulation", "Strategy", "Tactics", "Productivity", "Utility", "Creative tools"];
const CONTENT_NOTES = ["Violence", "Blood", "Horror", "Strong language", "Drug references", "Gambling-style mechanics", "Historical symbols"];
const ASSET_LICENSES = ["CC BY 4.0", "CC BY-SA 4.0", "CC0", "Same as the code"];
const NAME_RIGHTS = ["keep", "continuation", "rename"];
const MAX_LISTINGS_PER_USER = 25;
const MAX_LICENSE_BYTES = 200 * 1024;
const MAX_BODY_BYTES = 100 * 1024;

// ---------- small helpers ----------

// Text from a form: a string, without control characters, trimmed, within a length limit.
function text(v, max, { multiline = false, required = false } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") return { error: true };
  let s = v.replace(/\r\n?/g, "\n");
  s = multiline ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : s.replace(/[\u0000-\u001f\u007f]/g, " ");
  s = s.trim();
  if (s.length > max || (required && !s)) return { error: true };
  return { value: s };
}

function isCopyleft(spdx) {
  return typeof spdx === "string" && /^(GPL|AGPL|LGPL)-/.test(spdx);
}

function today() { return new Date().toISOString().slice(0, 10); }
function niceDate(iso) {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = String(iso || "").slice(0, 10).split("-");
  return d.length === 3 ? Number(d[2]) + " " + m[Number(d[1]) - 1] + " " + d[0] : "";
}

function parseRepoName(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "")
    .match(/^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}

function bad(error, status = 400, extra = {}) { return privateJson({ error, ...extra }, status); }

// ---------- GitHub lookups ----------

async function headCommit(env, session, fullName, branch) {
  const r = await githubGet(env, session, "/repos/" + fullName + "/commits/" + encodeURIComponent(branch));
  if (r.reauth) return { error: "github_sign_in_again", status: 401 };
  const sha = r.status === 200 && r.data && typeof r.data.sha === "string" && /^[0-9a-f]{40}$/.test(r.data.sha) ? r.data.sha : null;
  return sha ? { sha } : { error: "no_commits", status: 409 };
}

// The license file GitHub finds in the repo, at a given commit. null = no license.
async function fetchLicense(env, session, fullName, ref) {
  const r = await githubGet(env, session, "/repos/" + fullName + "/license" + (ref ? "?ref=" + encodeURIComponent(ref) : ""));
  if (r.reauth) return { error: "github_sign_in_again", status: 401 };
  if (r.status === 404) return { license: null };
  const d = r.data;
  if (r.status !== 200 || !d || typeof d.content !== "string") return { error: "github_error", status: 502 };
  let bytes;
  try {
    const bin = atob(d.content.replace(/\s+/g, ""));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return { error: "github_error", status: 502 }; }
  if (!bytes.length) return { license: null };
  if (bytes.length > MAX_LICENSE_BYTES) return { error: "license_too_large", status: 409 };
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let sha256 = "";
  for (const b of digest) sha256 += b.toString(16).padStart(2, "0");
  const spdx = d.license && typeof d.license.spdx_id === "string" && d.license.spdx_id !== "NOASSERTION" && /^[A-Za-z0-9.+-]{1,60}$/.test(d.license.spdx_id)
    ? d.license.spdx_id : null;
  return {
    license: {
      spdx, // null = GitHub found a license file but doesn't recognise it as a standard one
      path: typeof d.path === "string" && d.path.length <= 200 ? d.path : "LICENSE",
      bytes, sha256
    }
  };
}

async function fetchAgentFile(env, session, fullName) {
  for (const path of ["CLAUDE.md", "AGENTS.md"]) {
    const r = await githubGet(env, session, "/repos/" + fullName + "/contents/" + path);
    if (r.reauth) return null;
    if (r.status === 200 && r.data && typeof r.data.content === "string" && r.data.encoding === "base64") {
      try {
        const bin = atob(r.data.content.replace(/\s+/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const body = new TextDecoder().decode(bytes);
        if (body.trim()) return { path, text: body.slice(0, 20000) };
      } catch { /* try the next file */ }
    }
  }
  return null;
}

// ---------- the "handoff rules" block for CLAUDE.md / AGENTS.md ----------

export function handoffRules(p) {
  const lic = p.spdx;
  let licRule;
  if (lic === "Apache-2.0") {
    licRule = "- Code license: Apache-2.0. Keep LICENSE and NOTICE, and add a note at the top of any file you substantially change.\n" +
      "  Don't add GPL code (it can't be relicensed as Apache).\n" +
      "  Apache-2.0 grants no rights to the project's name or trademarks; the name rule below is what applies.";
  } else if (isCopyleft(lic)) {
    licRule = "- Code license: " + lic + ". Anything added must be " + lic + "-compatible, and the project must stay under " + lic + ".\n" +
      "  Don't copy in code under other licenses without checking, and check new dependencies' licenses first.";
  } else if (lic) {
    licRule = "- Code license: " + lic + ". Keep the copyright notice and LICENSE file. Code from other permissive licenses is fine; record it in CREDITS.md.";
  } else {
    licRule = "- Code license: see the LICENSE file (not a standard license). Read it before adding or copying any code.";
  }
  const assets = p.assetsLicense === "Same as the code"
    ? "- Assets: same license as the code. Credit original artists in CREDITS.md; list any new AI-generated assets there with the tool used."
    : p.assetsLicense === "CC0"
    ? "- Assets: CC0 (public domain). List any new AI-generated assets in CREDITS.md with the tool used."
    : "- Assets: " + p.assetsLicense + ". Credit original artists in CREDITS.md; list any new AI-generated assets there with the tool used.";
  const t = '"' + p.title + '"';
  const nameRule = p.intent !== "leave"
    ? "- Name: " + t + " belongs to the maintainer; contributions don't change that."
    : p.nameRights === "keep" ? "- Name: " + t + " may be used as-is."
    : p.nameRights === "continuation" ? "- Name: " + t + " may be used only as a continuation (the original name plus a subtitle of your own)."
    : "- Name: don't use " + t + " as this project's name. Pick a new one and credit the original.";
  const lines = ["## Brainchild handoff rules (keep this section)", licRule, assets, nameRule];
  if (p.kind === "Mod" && p.baseGame) {
    lines.push("- This is a mod for " + p.baseGame + ". The license covers only the mod's own files; " + p.baseGame + "'s own terms still apply.");
  }
  lines.push(
    "- Lineage: originally by @" + p.handle + " (github.com/" + p.repoFullName + "),",
    "  " + (p.intent === "leave" ? "handed off" : "listed") + " at commit " + p.commit.slice(0, 7) + " on " + niceDate(p.date) + ". Keep this credit in README.md.",
    "- If a change touches licensing, credits or the project name, flag it to the maintainer instead of deciding."
  );
  return lines.join("\n");
}

function licenseLabel(spdx, assetsLicense) {
  const code = spdx || "Custom license";
  return assetsLicense && assetsLicense !== "Same as the code" ? code + " + " + assetsLicense.replace(/ 4\.0$/, "") : code;
}

// ---------- GET /api/my/repos : the repo picker ----------

export async function myRepos(env, session) {
  if (!session) return bad("not_signed_in", 401);
  const r = await githubGet(env, session, "/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100");
  if (r.reauth) return bad("github_sign_in_again", 401);
  if (r.status !== 200 || !Array.isArray(r.data)) return bad("github_error", 502);
  const repos = r.data.filter((d) => d && Number.isSafeInteger(d.id) && typeof d.full_name === "string" && d.private !== true).slice(0, 100).map((d) => ({
    id: d.id,
    full_name: d.full_name,
    description: typeof d.description === "string" ? d.description.slice(0, 200) : "",
    admin: !!(d.permissions && d.permissions.admin === true),
    fork: d.fork === true,
    archived: d.archived === true,
    listed: null
  }));
  if (repos.length) {
    const marks = repos.map(() => "?").join(",");
    const { results } = await env.DB.prepare("SELECT id, repo_id FROM projects WHERE repo_id IN (" + marks + ")").bind(...repos.map((x) => x.id)).all();
    const byRepo = new Map(results.map((x) => [x.repo_id, x.id]));
    for (const x of repos) x.listed = byRepo.get(x.id) || null;
  }
  return privateJson({ repos });
}

// The listing for a repo, if there is one. Listings made before sign-in existed have no
// GitHub repo id, so those are matched on the repo address instead.
async function findListing(env, repo) {
  return env.DB.prepare(
    "SELECT id, owner_id, repo_id FROM projects WHERE repo_id = ?1 OR (repo_id IS NULL AND lower(repo_url) = lower(?2)) ORDER BY repo_id IS NULL LIMIT 1"
  ).bind(repo.id, "https://github.com/" + repo.full_name).first();
}
// An older listing that belongs to this user: listing the repo again completes that listing
// (verified owner, license record) instead of creating a second one.
function isLegacyOwn(existing, session) {
  return !!existing && existing.repo_id === null && existing.owner_id === session.userId;
}

// ---------- GET /api/repos/<owner>/<repo>/listing-info : everything the form needs about one repo ----------

export async function listingInfo(env, session, owner, name) {
  if (!session) return bad("not_signed_in", 401);
  const a = await repoAccess(env, session, owner, name);
  if (!a.ok) return bad(a.error, a.status);
  const out = { admin: a.admin, can_list: a.admin && !a.repo.private, repo: a.repo, license: null, agent_file: null, listed: null };
  const existing = await findListing(env, a.repo);
  if (existing) {
    out.listed = existing.id;
    out.can_update = out.can_list && isLegacyOwn(existing, session); // see createListing
  }
  if (!out.can_list) return privateJson(out);
  const lic = await fetchLicense(env, session, a.repo.full_name, null);
  if (lic.error) return bad(lic.error, lic.status);
  if (lic.license) out.license = { spdx: lic.license.spdx, path: lic.license.path, fingerprint: lic.license.sha256 };
  out.agent_file = await fetchAgentFile(env, session, a.repo.full_name);
  return privateJson(out);
}

// ---------- POST /api/projects : publish a listing (or preview it with dry_run) ----------

function validateListing(b) {
  const errors = [];
  const f = {};
  const take = (key, max, opts) => { const r = text(b[key], max, opts); if (r.error) errors.push(key); else f[key] = r.value; };

  const repo = parseRepoName(b.repo);
  if (!repo) errors.push("repo");
  f.intent = b.intent === "leave" ? "leave" : b.intent === "stay" ? "stay" : null;
  if (!f.intent) errors.push("intent");
  // Someone stepping away puts the project up for adoption; someone staying asks for help or testers.
  const allowed = f.intent === "leave" ? ["adopt"] : ["help", "test"];
  f.status = allowed.includes(b.status) ? b.status : null;
  if (!f.status) errors.push("status");

  take("title", 80, { required: true });
  f.kind = ["Game", "Mod", "App"].includes(b.kind) ? b.kind : null;
  if (!f.kind) errors.push("kind");
  f.genre = GENRES.includes(b.genre) ? b.genre : null;
  if (!f.genre) errors.push("genre");
  take("base_game", 80, { required: f.kind === "Mod" }); // mods must name their base game
  if (f.kind !== "Mod") f.base_game = "";
  take("tech", 60);
  f.browser = b.browser === true && f.kind !== "Mod" ? 1 : 0;
  take("note", 200, { required: true });

  f.rating = ["everyone", "teen", "mature"].includes(b.rating) ? b.rating : null;
  if (!f.rating) errors.push("rating");
  const notes = Array.isArray(b.content_notes) ? b.content_notes : [];
  f.content_notes = CONTENT_NOTES.filter((n) => notes.includes(n));
  if (notes.some((n) => !CONTENT_NOTES.includes(n))) errors.push("content_notes");

  f.assets_license = ASSET_LICENSES.includes(b.assets_license) ? b.assets_license : null;
  if (!f.assets_license) errors.push("assets_license");
  // The name question is only asked of makers who are leaving.
  f.name_rights = f.intent === "leave" ? (NAME_RIGHTS.includes(b.name_rights) ? b.name_rights : null) : null;
  if (f.intent === "leave" && !f.name_rights) errors.push("name_rights");
  f.open_to_transfer = f.intent === "leave" && b.open_to_transfer === true ? 1 : 0;

  take("works", 2000, { multiline: true, required: true });
  take("broken", 2000, { multiline: true });
  take("vision", 2000, { multiline: true });
  take("agent_context", 20000, { multiline: true });
  const prov = Array.isArray(b.provenance) ? b.provenance : [];
  f.provenance = [];
  if (prov.length > 30) errors.push("provenance");
  for (const row of prov.slice(0, 30)) {
    const part = text(row && row.part, 80), how = text(row && row.how, 200);
    if (part.error || how.error) { errors.push("provenance"); break; }
    if (part.value || how.value) f.provenance.push({ part: part.value, how: how.value });
  }
  if (b.agreed !== true) errors.push("agreed"); // the release statement must be ticked
  return { errors: [...new Set(errors)], f, repo };
}

async function uniqueSlug(env, repoName, owner) {
  const base = (repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project").slice(0, 60);
  const withOwner = (base + "-" + owner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).slice(0, 76);
  for (const candidate of [base, withOwner]) {
    if (!(await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?").bind(candidate).first())) return candidate;
  }
  for (let i = 2; i < 50; i++) {
    const candidate = withOwner + "-" + i;
    if (!(await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?").bind(candidate).first())) return candidate;
  }
  return null;
}

// Keep a copy of the license text. The key is the fingerprint, so the same text is stored once
// and a stored copy is never replaced by different content.
async function storeLicense(env, license) {
  const key = "licenses/" + license.sha256;
  if (!(await env.BUILDS.head(key))) {
    await env.BUILDS.put(key, license.bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  }
  return key;
}

async function forgetCached(request, paths) {
  const origin = new URL(request.url).origin;
  await Promise.all(paths.map((p) => caches.default.delete(origin + p).catch(() => false)));
}

export async function createListing(request, env, ctx, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const { errors, f, repo } = validateListing(body);
  if (errors.length) return bad("invalid_fields", 400, { fields: errors });

  // Ownership is checked now, at the moment of publishing, never from an earlier answer.
  const own = await requireRepoAdmin(env, session, repo.owner, repo.name);
  if (own.response) return own.response;
  const r = own.repo;
  if (!r.default_branch) return bad("no_commits", 409);
  const existing = await findListing(env, r);
  const upgrade = isLegacyOwn(existing, session);
  if (existing && !upgrade) return bad("already_listed", 409, { id: existing.id });

  const head = await headCommit(env, session, r.full_name, r.default_branch);
  if (head.error) return bad(head.error, head.status);
  const lic = await fetchLicense(env, session, r.full_name, head.sha);
  if (lic.error) return bad(lic.error, lic.status);
  if (!lic.license) return bad("no_license", 409);

  const date = today();
  const rules = handoffRules({
    spdx: lic.license.spdx, assetsLicense: f.assets_license, title: f.title, intent: f.intent, nameRights: f.name_rights,
    kind: f.kind, baseGame: f.base_game, handle: session.handle, repoFullName: r.full_name, commit: head.sha, date
  });
  const summary = {
    title: f.title, owner: session.handle, license: lic.license.spdx, license_path: lic.license.path,
    fingerprint: lic.license.sha256, commit: head.sha, date, repo: r.full_name
  };
  if (body.dry_run === true) return privateJson({ ok: true, dry_run: true, summary, rules });

  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").bind(session.userId).first();
  if (mine && mine.n >= MAX_LISTINGS_PER_USER) return bad("too_many_listings", 429);
  const id = upgrade ? existing.id : await uniqueSlug(env, r.name || repo.name, r.owner || repo.owner);
  if (!id) return bad("server_error", 500);
  const licenseKey = await storeLicense(env, lic.license);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const handedOff = f.intent === "leave" ? now : null;

  const label = licenseLabel(lic.license.spdx, f.assets_license);
  const repoUrl = "https://github.com/" + r.full_name;
  const statements = upgrade ? [
    env.DB.prepare(
      `UPDATE projects SET title = ?, kind = ?, genre = ?, status = ?, base_game = ?, tech = ?, browser = ?, license = ?, note = ?,
              repo_url = ?, updated_at = ?, handed_off_at = ?, intent = ?, repo_id = ?, repo_full_name = ?, rating = ?,
              content_notes = ?, assets_license = ?, name_rights = ?, open_to_transfer = ?
        WHERE id = ? AND repo_id IS NULL AND owner_id = ?`
    ).bind(f.title, f.kind, f.genre, f.status, f.base_game || null, f.tech || null, f.browser, label, f.note, repoUrl, now, handedOff,
      f.intent, r.id, r.full_name, f.rating, JSON.stringify(f.content_notes), f.assets_license, f.name_rights, f.open_to_transfer,
      id, session.userId),
    env.DB.prepare(
      `INSERT INTO packets (project_id, works, broken, vision, agent_context, provenance, handoff_rules, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET works = excluded.works, broken = excluded.broken, vision = excluded.vision,
         agent_context = excluded.agent_context, provenance = excluded.provenance, handoff_rules = excluded.handoff_rules, updated_at = excluded.updated_at`
    ).bind(id, f.works, f.broken || null, f.vision || null, f.agent_context || null, JSON.stringify(f.provenance), rules, now),
    // The lineage entry made with the old listing is kept; it only gains the repo it refers to.
    env.DB.prepare("UPDATE lineage SET how = 'created', repo_full_name = ? WHERE project_id = ? AND user_id = ? AND how IS NULL")
      .bind(r.full_name, id, session.userId),
    env.DB.prepare(
      `INSERT INTO lineage (project_id, user_id, role, started_at, how, repo_full_name)
       SELECT ?, ?, 'creator', ?, 'created', ? WHERE NOT EXISTS (SELECT 1 FROM lineage WHERE project_id = ?)`
    ).bind(id, session.userId, now, r.full_name, id)
  ] : [
    env.DB.prepare(
      `INSERT INTO projects (id, title, kind, genre, status, base_game, tech, browser, license, note, owner_id, repo_url,
                             created_at, updated_at, handed_off_at, intent, repo_id, repo_full_name, rating, content_notes,
                             assets_license, name_rights, open_to_transfer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, f.title, f.kind, f.genre, f.status, f.base_game || null, f.tech || null, f.browser, label, f.note, session.userId, repoUrl,
      now, now, handedOff, f.intent, r.id, r.full_name, f.rating, JSON.stringify(f.content_notes),
      f.assets_license, f.name_rights, f.open_to_transfer),
    env.DB.prepare(
      "INSERT INTO packets (project_id, works, broken, vision, agent_context, provenance, handoff_rules, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, f.works, f.broken || null, f.vision || null, f.agent_context || null, JSON.stringify(f.provenance), rules, now),
    env.DB.prepare(
      "INSERT INTO lineage (project_id, user_id, role, started_at, how, repo_full_name) VALUES (?, ?, 'creator', ?, 'created', ?)"
    ).bind(id, session.userId, now, r.full_name)
  ];
  // The license record. If two publishes race, the second fails here (version 1 exists) and nothing is saved twice.
  statements.push(env.DB.prepare(
    `INSERT INTO license_records (project_id, version, kind, repo_full_name, commit_sha, spdx_id, license_sha256, license_key,
                                  license_path, assets_license, name_rights, recorded_by, recorded_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, f.intent === "leave" ? "handoff" : "listing", r.full_name, head.sha, lic.license.spdx, lic.license.sha256, licenseKey,
    lic.license.path, f.assets_license, f.name_rights, session.userId, now));
  try {
    await env.DB.batch(statements);
  } catch (err) {
    // Most likely two publishes of the same repo at once.
    console.error("listing: insert failed:", err && err.message);
    return bad("already_listed", 409);
  }
  ctx.waitUntil(forgetCached(request, ["/api/projects", "/api/projects/" + id, "/api/projects/" + id + "/license"]));
  return privateJson({ ok: true, id, url: "/project.html?id=" + encodeURIComponent(id), summary, rules }, 201);
}

// ---------- GET /api/projects/<id>/license : the public license record ----------

export async function licenseRecord(env, id) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return json({ error: "not_found" }, 404, NO_STORE);
  const project = await env.DB.prepare(
    `SELECT p.id, p.title, p.kind, p.base_game, p.status, u.handle AS owner
       FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?`
  ).bind(id).first();
  if (!project) return json({ error: "not_found" }, 404, NO_STORE);
  const { results: records } = await env.DB.prepare(
    `SELECT r.version, r.kind, r.repo_full_name, r.commit_sha, r.spdx_id, r.license_sha256, r.license_path,
            r.assets_license, r.name_rights, r.recorded_at, u.handle AS recorded_by
       FROM license_records r LEFT JOIN users u ON u.id = r.recorded_by
      WHERE r.project_id = ? ORDER BY r.version`
  ).bind(id).all();
  const { results: lineage } = await env.DB.prepare(
    `SELECT u.handle, l.role, l.how, l.repo_full_name, l.started_at, l.ended_at
       FROM lineage l JOIN users u ON u.id = l.user_id WHERE l.project_id = ? ORDER BY l.started_at, l.id`
  ).bind(id).all();
  return json({ project, records, lineage });
}

// ---------- GET /api/license-text/<fingerprint> : the stored copy ----------

export async function licenseText(env, url, sha) {
  if (!/^[0-9a-f]{64}$/.test(sha)) return json({ error: "not_found" }, 404, NO_STORE);
  const obj = await env.BUILDS.get("licenses/" + sha);
  if (!obj) return json({ error: "not_found" }, 404, NO_STORE);
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "public, max-age=31536000, immutable" // the address is the content's fingerprint
  };
  if (url.searchParams.get("download") === "1") headers["content-disposition"] = 'attachment; filename="LICENSE-' + sha.slice(0, 8) + '.txt"';
  return new Response(obj.body, { status: 200, headers });
}

// ---------- POST /api/projects/<id>/adopt ----------

export async function adoptProject(request, env, ctx, session, id) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return bad("not_found", 404);
  const body = await readJson(request);
  if (!body) return bad("bad_request");
  const repo = parseRepoName(body.repo);
  const method = body.method === "transfer" ? "transfer" : body.method === "fork" ? "fork" : null;
  if (!repo || !method) return bad("invalid_fields", 400, { fields: [!repo ? "repo" : "method"] });

  const p = await env.DB.prepare(
    `SELECT p.id, p.title, p.kind, p.base_game, p.status, p.owner_id, p.repo_id, p.repo_full_name, p.repo_url,
            p.name_rights, p.assets_license, p.open_to_transfer, p.intent, u.handle AS owner
       FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?`
  ).bind(id).first();
  if (!p) return bad("not_found", 404);
  if (p.status !== "adopt") return bad("not_up_for_adoption", 409);
  if (p.owner_id && p.owner_id === session.userId) return bad("already_yours", 409);
  if (method === "transfer" && !p.open_to_transfer) return bad("transfer_not_offered", 409);

  // The name rule the maker set travels with the project.
  let title = p.title;
  if (body.title !== undefined && body.title !== null && body.title !== "") {
    const t = text(body.title, 80, { required: true });
    if (t.error) return bad("invalid_fields", 400, { fields: ["title"] });
    title = t.value;
  }
  if (p.name_rights === "rename" && title.toLowerCase() === p.title.toLowerCase()) return bad("must_rename", 409);
  if (p.name_rights === "continuation" && title !== p.title && !title.toLowerCase().includes(p.title.toLowerCase())) {
    return bad("must_keep_original_name", 409);
  }

  // The adopter must control the repo they are linking, checked right now.
  const own = await requireRepoAdmin(env, session, repo.owner, repo.name);
  if (own.response) return own.response;
  const r = own.repo;
  if (!r.default_branch) return bad("no_commits", 409);
  const other = await env.DB.prepare("SELECT id FROM projects WHERE repo_id = ? AND id <> ?").bind(r.id, id).first();
  if (other) return bad("already_listed", 409, { id: other.id });

  // Where the project lives today, as GitHub reports it (this follows renames and transfers).
  const oldName = p.repo_full_name || (parseRepoName(p.repo_url) ? parseRepoName(p.repo_url).owner + "/" + parseRepoName(p.repo_url).name : null);
  let originalId = p.repo_id;
  if (!originalId && oldName) {
    const o = parseRepoName(oldName);
    const look = await repoAccess(env, session, o.owner, o.name);
    if (look.ok) originalId = look.repo.id;
  }
  if (!originalId) return bad("original_repo_unknown", 409);
  if (method === "fork") {
    // GitHub's "parent" field is the proof that this repo was forked from the original.
    if (!r.fork || r.parent_id !== originalId) return bad("not_a_fork_of_original", 409);
  } else if (r.id !== originalId) {
    // A transferred repo keeps its GitHub id; only its owner changes.
    return bad("not_the_transferred_repo", 409);
  }

  const head = await headCommit(env, session, r.full_name, r.default_branch);
  if (head.error) return bad(head.error, head.status);
  const lic = await fetchLicense(env, session, r.full_name, head.sha);
  if (lic.error) return bad(lic.error, lic.status);
  if (!lic.license) return bad("no_license", 409);
  const last = await env.DB.prepare(
    "SELECT version, spdx_id, license_sha256 FROM license_records WHERE project_id = ? ORDER BY version DESC LIMIT 1"
  ).bind(id).first();
  // Permissive code may be relicensed by the adopter. GPL-family code stays as it was released.
  if (last && isCopyleft(last.spdx_id) && lic.license.spdx !== last.spdx_id) {
    return bad("license_must_stay", 409, { license: last.spdx_id });
  }
  const relicensed = !!(last && (last.spdx_id || null) !== (lic.license.spdx || null));

  const summary = {
    title, repo: r.full_name, method, license: lic.license.spdx, previous_license: last ? last.spdx_id : null, relicensed,
    commit: head.sha, fingerprint: lic.license.sha256, date: today()
  };
  const packet = await env.DB.prepare("SELECT handoff_rules FROM packets WHERE project_id = ?").bind(id).first();
  // The rules the adopter pastes into CLAUDE.md / AGENTS.md: the maker's rules if they were
  // recorded, otherwise rules written from what the listing says.
  const rules = (packet && packet.handoff_rules) || handoffRules({
    spdx: last ? last.spdx_id : lic.license.spdx, assetsLicense: p.assets_license || "Same as the code", title: p.title,
    intent: "leave", nameRights: p.name_rights || "continuation", kind: p.kind, baseGame: p.base_game,
    handle: p.owner || "the original maker", repoFullName: oldName || r.full_name, commit: head.sha, date: today()
  });
  if (body.dry_run === true) return privateJson({ ok: true, dry_run: true, summary, rules });

  const licenseKey = await storeLicense(env, lic.license);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const version = (last ? last.version : 0) + 1;
  const result = await env.DB.batch([
    // Only one adoption can win: this changes nothing unless the project is still up for adoption.
    env.DB.prepare(
      `UPDATE projects SET owner_id = ?, title = ?, repo_url = ?, repo_id = ?, repo_full_name = ?, status = 'active', intent = 'stay',
              open_to_transfer = 0, handed_off_at = ?, updated_at = ?, license = ?
        WHERE id = ? AND status = 'adopt'`
    ).bind(session.userId, title, "https://github.com/" + r.full_name, r.id, r.full_name, now, now,
      licenseLabel(lic.license.spdx, p.assets_license), id),
    // Earlier maintainers stay in the lineage; their entry is closed, never deleted.
    env.DB.prepare(
      "UPDATE lineage SET ended_at = ? WHERE project_id = ? AND ended_at IS NULL AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND updated_at = ?)"
    ).bind(now, id, id, session.userId, now),
    env.DB.prepare(
      `INSERT INTO lineage (project_id, user_id, role, started_at, how, repo_full_name)
       SELECT ?, ?, 'maintainer', ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND updated_at = ?)`
    ).bind(id, session.userId, now, method === "transfer" ? "transferred" : "forked", r.full_name, id, session.userId, now),
    env.DB.prepare(
      `INSERT INTO license_records (project_id, version, kind, repo_full_name, commit_sha, spdx_id, license_sha256, license_key,
                                    license_path, assets_license, name_rights, recorded_by, recorded_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND updated_at = ?)`
    ).bind(id, version, relicensed ? "relicense" : "adoption", r.full_name, head.sha, lic.license.spdx, lic.license.sha256, licenseKey,
      lic.license.path, p.assets_license, p.name_rights, session.userId, now, id, session.userId, now)
  ]);
  if (!result[0].meta || result[0].meta.changes !== 1) return bad("not_up_for_adoption", 409);
  ctx.waitUntil(forgetCached(request, ["/api/projects", "/api/projects/" + id, "/api/projects/" + id + "/license"]));
  return privateJson({ ok: true, id, url: "/project.html?id=" + encodeURIComponent(id), summary, rules });
}
