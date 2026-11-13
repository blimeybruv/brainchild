// Asking Software Heritage (a free public archive of source code) to keep a copy of a repo
// when it is listed, handed off or adopted, so the code survives if the repo disappears.
//
// Rules encoded here:
//   - Only the public repo address is sent. Nothing about the user.
//   - A listing never waits on the archive and never fails because of it: requests are sent
//     after the response, and a failed send is retried later.
//   - Retries and status checks are gentle: at most once every ten minutes per request, and
//     only when someone opens the project's license record. A send is tried five times at most.

const USER_AGENT = "brainchild.nexus";
const MAX_SENDS = 5;

function base(env) { return env.SWH_API_BASE || "https://archive.softwareheritage.org"; }
function recheckSeconds(env) { return Number(env.SWH_RECHECK_SECONDS) || 600; }
function nowText() { return new Date().toISOString().replace("T", " ").slice(0, 19); }

// The statement that queues a request; it goes in the same batch as the license record.
export function queueArchive(env, projectId, version, repoFullName, now) {
  return env.DB.prepare(
    `INSERT INTO archive_requests (project_id, license_version, repo_url, status, requested_at)
     SELECT ?, ?, ?, 'queued', ? WHERE EXISTS (SELECT 1 FROM license_records WHERE project_id = ? AND version = ?)`
  ).bind(projectId, version, "https://github.com/" + repoFullName, now, projectId, version);
}

function statusFrom(d) {
  if (d.save_request_status === "rejected" || d.save_task_status === "failed") return "failed";
  if (d.save_task_status === "succeeded") return "archived";
  return "requested";
}

async function send(env, row) {
  let res, data = null;
  try {
    res = await fetch(base(env) + "/api/1/origin/save/git/url/" + row.repo_url + "/", {
      method: "POST", headers: { accept: "application/json", "user-agent": USER_AGENT }
    });
    data = await res.json();
  } catch { res = res || null; }
  const now = nowText();
  if (res && res.ok && data && Number.isSafeInteger(data.id)) {
    await env.DB.prepare("UPDATE archive_requests SET swh_id = ?, status = ?, swhid = ?, attempts = attempts + 1, checked_at = ? WHERE id = ?")
      .bind(data.id, statusFrom(data), typeof data.snapshot_swhid === "string" ? data.snapshot_swhid : null, now, row.id).run();
    return;
  }
  // 400 or 403 means Software Heritage won't take this address; anything else is worth another try later.
  const final = res && (res.status === 400 || res.status === 403);
  const attempts = row.attempts + 1;
  await env.DB.prepare("UPDATE archive_requests SET status = ?, attempts = ?, checked_at = ? WHERE id = ?")
    .bind(final || attempts >= MAX_SENDS ? "failed" : "queued", attempts, now, row.id).run();
  if (!final) console.error("archive: request not accepted yet, status", res ? res.status : "network");
}

async function check(env, row) {
  let data = null;
  try {
    const res = await fetch(base(env) + "/api/1/origin/save/" + row.swh_id + "/", { headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (res.ok) data = await res.json();
  } catch { data = null; }
  const now = nowText();
  if (!data) { await env.DB.prepare("UPDATE archive_requests SET checked_at = ? WHERE id = ?").bind(now, row.id).run(); return; }
  await env.DB.prepare("UPDATE archive_requests SET status = ?, swhid = ?, checked_at = ? WHERE id = ?")
    .bind(statusFrom(data), typeof data.snapshot_swhid === "string" && /^swh:1:snp:[0-9a-f]{40}$/.test(data.snapshot_swhid) ? data.snapshot_swhid : null, now, row.id).run();
}

// Send anything still queued for this project, and look up anything in progress, if it is due.
export async function refreshArchives(env, projectId, force) {
  const cutoff = new Date(Date.now() - recheckSeconds(env) * 1000).toISOString().replace("T", " ").slice(0, 19);
  const { results } = await env.DB.prepare(
    `SELECT id, repo_url, swh_id, status, attempts FROM archive_requests
      WHERE project_id = ? AND status IN ('queued', 'requested') AND (?2 = 1 OR checked_at IS NULL OR checked_at < ?3) ORDER BY id LIMIT 3`
  ).bind(projectId, force ? 1 : 0, cutoff).all();
  for (const row of results) {
    if (row.status === "queued") await send(env, row); else await check(env, row);
  }
}

// What the license record page shows, per license version.
export async function archiveStatus(env, projectId) {
  const { results } = await env.DB.prepare(
    "SELECT license_version, status, swhid, repo_url FROM archive_requests WHERE project_id = ? ORDER BY id"
  ).bind(projectId).all();
  return results.map((r) => ({
    version: r.license_version,
    status: r.status === "queued" ? "requested" : r.status, // the page doesn't need to know about retries
    swhid: r.status === "archived" ? r.swhid : null,
    url: r.status === "archived"
      ? (r.swhid ? "https://archive.softwareheritage.org/" + r.swhid + ";origin=" + r.repo_url
                 : "https://archive.softwareheritage.org/browse/origin/directory/?origin_url=" + encodeURIComponent(r.repo_url))
      : null
  }));
}
