// The checks of the 16 Nov security review. Each block states what should be true; before the fixes
// sections 1 to 8 had failures (those were the findings), and now every line should say "ok".
// How to run: see the top of rig.mjs.
import { start, Client, world, repo, listing, check, section, done } from "./rig.mjs";

const { mf, db } = await start();
const owner = new Client(mf, "owner"), mod = new Client(mf, "mod"), eve = new Client(mf, "eve");

section("0. Baseline: sign-in, listing, edit");
let s = await owner.signIn("owner");
check("owner signs in", s.started && s.last.status === 302 && owner.jar.has("__Host-bc_session"), "status " + (s.last && s.last.status));
await mod.signIn("mod"); await eve.signIn("eve");
check("moderator flag follows the GitHub id", (await mod.me()).moderator === true && (await owner.me()).moderator === false);
check("no email in the users table", (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email IS NOT NULL").first()).n === 0);
repo("owner/game", { id: 5001 });
let r = await owner.post("/api/projects", listing("owner/game", { rating: "everyone" }));
check("owner lists a project", r.status === 201 && r.data.id === "game", JSON.stringify(r.data).slice(0, 120));
const pid = r.data.id;
const editBody = (o = {}) => ({ title: "Test Game", note: "A test game.", tech: "JS", genre: "Puzzle", browser: false, status: "help", rating: "everyone", content_notes: [], works: "It runs.", ...o });
r = await owner.post(`/api/projects/${pid}/edit`, editBody({ note: "A test game, edited." }));
check("owner edits the page", r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await eve.post(`/api/projects/${pid}/edit`, editBody({ note: "eve was here" }));
check("someone else can't edit", r.status === 403);
r = await owner.post(`/api/projects/${pid}/edit`, editBody({ note: "csrf" }), { headers: { origin: "https://evil.example" } });
check("cross-site POST is refused", r.status === 403);

section("1. A moderator's re-rating must hold until an appeal restores it");
r = await mod.post(`/api/mod/projects/${pid}/rating`, { rating: "mature", content_notes: ["Violence", "Blood"], reasons: "Graphic gore in the first level; the Mature criteria apply." });
check("moderator re-rates to Mature", r.status === 200, JSON.stringify(r.data));
const actionId = r.data && r.data.action_id;
r = await owner.post(`/api/projects/${pid}/edit`, editBody({ rating: "everyone", content_notes: [] }));
let row = await db.prepare("SELECT rating FROM projects WHERE id = ?").bind(pid).first();
check("maintainer can't lower it through the Edit page", r.status === 409 && row.rating === "mature", `status ${r.status}, rating now ${row.rating}`);
r = await owner.post(`/api/projects/${pid}/edit`, editBody({ rating: "teen", content_notes: ["Violence"] }));
row = await db.prepare("SELECT rating FROM projects WHERE id = ?").bind(pid).first();
check("...nor to Teen", r.status === 409 && row.rating === "mature", `status ${r.status}, rating now ${row.rating}`);
r = await owner.post("/api/projects", listing("owner/game", { intent: "leave", status: "adopt", name_rights: "keep", rating: "everyone" }));
row = await db.prepare("SELECT rating, status FROM projects WHERE id = ?").bind(pid).first();
check("...nor through the handoff flow", r.status === 409 && row.rating === "mature", `status ${r.status}, rating now ${row.rating}, status ${row.status}`);
r = await owner.post(`/api/projects/${pid}/edit`, editBody({ rating: "mature", content_notes: ["Violence", "Blood"], note: "Other edits still work." }));
check("other edits still save while the rating stands", r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await owner.post(`/api/my/notices/${actionId}/appeal`, { text: "The gore was removed in the latest build, please look again." });
check("maintainer can appeal", r.status === 200);
r = await mod.post(`/api/mod/actions/${actionId}/appeal`, { decision: "restore", note: "Checked, fine." });
row = await db.prepare("SELECT rating FROM projects WHERE id = ?").bind(pid).first();
check("a restored appeal puts the maker's rating back", r.status === 200 && row.rating === "everyone", row.rating);
r = await owner.post(`/api/projects/${pid}/edit`, editBody({ rating: "teen", content_notes: ["Violence"] }));
check("after a restored appeal the maintainer sets the rating again", r.status === 200, JSON.stringify(r.data));

section("2. A removed project's license copy must stop being served");
const lic = await owner.get(`/api/projects/${pid}/license`);
const fp = lic.data.records[0].license_sha256;
r = await owner.get(`/api/license-text/${fp}`);
check("license copy is served while the project is listed", r.status === 200 && /MIT License/.test(r.text));
check("...and is not stored in caches for a year", !/31536000|immutable/.test(r.headers.get("cache-control") || ""), r.headers.get("cache-control"));
r = await eve.post("/api/reports", { project_id: pid, category: "other", details: "Doxxing text inside the LICENSE file." });
const reportId = r.data.id;
r = await mod.post(`/api/mod/reports/${reportId}/resolve`, { decision: "remove", ground: "illegal", reasons: "The license file contains someone's home address." });
check("moderator removes the project", r.status === 200, JSON.stringify(r.data));
r = await owner.get(`/api/license-text/${fp}?x=${Date.now()}`);
check("license copy is gone once the project is removed", r.status === 404, "status " + r.status);
r = await owner.get(`/api/projects/${pid}`);
check("project page data is gone", r.status === 404);
await db.prepare("UPDATE projects SET hidden_at = NULL WHERE id = ?").bind(pid).run();

section("3. An account record with no sign-in must not be claimable by a matching GitHub name");
await db.prepare("INSERT INTO users (id, handle) VALUES ('u-sample-ada', 'sample-ada')").run();
const ada = new Client(mf, "ada");
await ada.signIn("sample-ada");
row = await db.prepare("SELECT i.user_id FROM identities i WHERE i.provider = 'github' AND i.provider_user_id = '1004'").first();
check("a GitHub account named sample-ada gets its own new account", !!row && row.user_id !== "u-sample-ada", row && row.user_id);

section("4. Linking can't be started from another site");
const victim = new Client(mf, "victim");
world.gl.users.vic = { id: 2002, username: "vic" };
await victim.signIn("vic", "gitlab");
check("GitLab-only account exists", (await victim.me()).handle === "vic");
world.gh.users.vicgh = { id: 1010, login: "VicRealName" };
world.gh.users.VicRealName = world.gh.users.vicgh;
let a = await victim.get("/api/auth/login?provider=github&link=1&return_to=%2Faccount.html", { headers: { "sec-fetch-site": "cross-site", referer: "https://evil.example/" } });
check("cross-site start of linking is refused", a.status === 302 && !/github\.com\/login\/oauth/.test(a.location || ""), a.location);
a = await victim.get("/api/auth/gitlab/login?link=1&return_to=%2Faccount.html", { headers: { "sec-fetch-site": "cross-site" } });
check("...for GitLab too", a.status === 302 && !/gitlab\.com\/oauth/.test(a.location || ""), a.location);
a = await victim.get("/api/auth/login?provider=github&link=1&return_to=%2Faccount.html", { headers: { "sec-fetch-site": "same-origin" } });
check("linking from the account page still starts", a.status === 302 && /github\.com\/login\/oauth/.test(a.location || ""), a.location);
a = await victim.get("/api/auth/login?provider=github&link=1&return_to=%2Faccount.html", { headers: { referer: "https://brainchild.nexus/account.html" } });
check("...also in a browser that sends only a Referer", a.status === 302 && /github\.com\/login\/oauth/.test(a.location || ""), a.location);
const linked = await victim.signIn("vicgh", "github", "&link=1", { "sec-fetch-site": "same-origin" });
check("the link completes", linked.started && /signin=linked/.test(linked.last.location || ""), linked.last && linked.last.location);
a = await new Client(mf, "anon").get("/api/auth/login?provider=github&return_to=%2F", { headers: { "sec-fetch-site": "cross-site" } });
check("plain sign-in from another site still works (a link from anywhere)", a.status === 302 && /github\.com\/login\/oauth/.test(a.location || ""));

section("5. Ownership re-checks must be about the same repository, not just the same name");
repo("bob/tool", { id: 6001 });
const bob = new Client(mf, "bob");
await bob.signIn("bob");
r = await bob.post("/api/projects", listing("bob/tool", { title: "Tool" }));
check("bob lists bob/tool", r.status === 201, JSON.stringify(r.data).slice(0, 100));
const toolId = r.data.id;
// bob transfers the real repo away and creates a new, different repo under the old name
world.gh.repos["carol/tool"] = { ...world.gh.repos["bob/tool"], full_name: "carol/tool", admins: ["carol"] };
repo("bob/tool", { id: 6999, licenseText: "Do whatever.\n", spdx: null });
r = await bob.post(`/api/projects/${toolId}/edit`, editBody({ title: "Tool", note: "Edited after the repo moved." }));
const recs = await db.prepare("SELECT COUNT(*) AS n FROM license_records WHERE project_id = ?").bind(toolId).first();
check("a different repo under the old name doesn't pass the check", r.status >= 400 && recs.n === 1, `status ${r.status} ${JSON.stringify(r.data)}, license records ${recs.n}`);

section("6. Self-hosted GitLab: answers are capped while they arrive, and a silent host is given up on");
world.sh.projects["grp/proj"] = { id: 42, path: "grp/proj", sha: "b".repeat(40), licenseText: "MIT License\n", verify: null };
r = await eve.post("/api/verify-code", { url: "https://git.selfhost.org/grp/proj" });
check("a verification code is issued", r.status === 200 && /^brainchild-/.test(r.data.code), JSON.stringify(r.data).slice(0, 80));
world.sh.projects["grp/proj"].verify = r.data.code + "\n";
r = await eve.get("/api/listing-info?host=selfhosted&repo=" + encodeURIComponent("https://git.selfhost.org/grp/proj"));
check("the code in the file verifies push access", r.status === 200 && r.data.can_list === true && r.data.repo.url === "https://git.selfhost.org/grp/proj", JSON.stringify(r.data).slice(0, 160));
world.sh.huge = true; world.sh.sent = 0;
r = await eve.get("/api/listing-info?host=selfhosted&repo=" + encodeURIComponent("https://git.selfhost.org/grp/proj"));
check("an endless answer is cut off early", r.status === 502 && world.sh.sent < 8 * 1024 * 1024, `status ${r.status}, the host had sent ${Math.round(world.sh.sent / 1024)} KB when Brainchild answered, connection dropped: ${world.sh.cancelled}`);
world.sh.huge = false; world.sh.hang = true;
const t0 = Date.now();
r = await eve.get("/api/listing-info?host=selfhosted&repo=" + encodeURIComponent("https://git.selfhost.org/grp/proj"));
check("a host that never answers is given up on", r.status === 502 && Date.now() - t0 < 20000, `status ${r.status} after ${Date.now() - t0} ms`);
world.sh.hang = false;
for (const bad of ["https://127.0.0.1/a/b", "https://localhost/a/b", "https://git.internal/a/b", "http://git.selfhost.org/a/b", "https://user@git.selfhost.org/a/b", "https://git.selfhost.org:8443/a/b", "https://brainchild.nexus/a/b", "https://game.brainwave.nexus/a/b"]) {
  r = await eve.post("/api/verify-code", { url: bad });
  check("refused: " + bad, r.status === 400, "status " + r.status);
}

section("7. Project ids that read like part of the site can't be taken by a repo name");
for (const name of ["login", "www", "brainchild", "admin"]) {
  repo("eve/" + name, { id: 7000 + name.length * 7 + name.charCodeAt(0) });
  r = await eve.post("/api/projects", listing("eve/" + name, { title: "Totally a game" }));
  check(`repo "${name}" doesn't get the id "${name}"`, r.status === 201 && r.data.id !== name, r.data && r.data.id);
}

section("8. Housekeeping the privacy page promises");
{
  const fresh = await start();
  const c = new Client(fresh.mf, "x");
  await fresh.db.prepare("INSERT INTO users (id, handle) VALUES ('u1', 'someone')").run();
  await fresh.db.prepare("INSERT INTO net_flags (kind, scope, user_id, net_hash, expires_at) VALUES ('vote', '2020-01', 'u1', 'x', '2020-03-01')").run();
  await fresh.db.prepare("INSERT INTO net_flags (kind, scope, user_id, net_hash, expires_at) VALUES ('vote', '2999-01', 'u1', 'y', '2999-03-01')").run();
  await fresh.db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES ('dead', 'u1', 1, 2)").run();
  await fresh.db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES ('live', 'u1', 1, 99999999999)").run();
  await c.get("/api/me"); // any page view
  await new Promise((d) => setTimeout(d, 500));
  const left = await fresh.db.prepare("SELECT (SELECT COUNT(*) FROM net_flags) AS flags, (SELECT COUNT(*) FROM sessions) AS sessions").first();
  check("expired network codes and sessions go on an ordinary page view; live ones stay", left.flags === 1 && left.sessions === 1, `flags ${left.flags}, sessions ${left.sessions}`);
  await fresh.mf.dispose();
}

section("9. Regression: adoption, hosted build, screenshots, merge, sign-out still work");
{
  repo("owner/handme", { id: 8001 });
  r = await owner.post("/api/projects", listing("owner/handme", { title: "Hand Me", intent: "leave", status: "adopt", name_rights: "keep", open_to_transfer: true }));
  check("owner lists a project for adoption", r.status === 201, JSON.stringify(r.data).slice(0, 80));
  const hid = r.data.id;
  repo("eve/handme", { id: 8002, parent: { full_name: "owner/handme", id: 8001 } });
  r = await eve.post(`/api/projects/${hid}/adopt`, { method: "fork", repo: "eve/handme" });
  check("eve adopts it with her fork", r.status === 200 && r.data.ok, JSON.stringify(r.data).slice(0, 120));
  repo("eve/unrelated", { id: 8003 });
  r = await bob.post(`/api/projects/${hid}/adopt`, { method: "fork", repo: "eve/unrelated" });
  check("a second adoption is refused", r.status === 409 || r.status === 403, "status " + r.status);
  r = await owner.post(`/api/projects/${hid}/edit`, editBody({ title: "Hand Me" }));
  check("the previous maintainer can no longer edit", r.status === 403);
  r = await eve.post(`/api/projects/${hid}/builds`, {});
  check("the new maintainer starts a build upload", r.status === 201 && /^[a-f0-9]{20}$/.test(r.data.build), JSON.stringify(r.data).slice(0, 80));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  r = await eve.req("POST", `/api/projects/${hid}/screenshots`, { raw: png, headers: { "content-type": "image/png" } });
  check("the new maintainer adds a screenshot", r.status === 201, JSON.stringify(r.data));
  r = await eve.req("POST", `/api/projects/${hid}/screenshots`, { raw: new TextEncoder().encode("<svg onload=alert(1)>"), headers: { "content-type": "image/svg+xml" } });
  check("an SVG is refused", r.status === 415);
  // merge: an account that only pitched a post can be folded in
  world.gl.users.pitcher = { id: 2050, username: "pitcher" };
  const pc = new Client(mf, "pitcher");
  await pc.signIn("pitcher", "gitlab");
  r = await pc.post("/api/pitches", { topic: "Guide", title: "A guide", body: "x".repeat(40) });
  check("a member pitches a post", r.status === 201);
  r = await mod.post("/api/mod/merge", { from: "pitcher", into: "eve", reason: "Same person, confirmed while signed in to each." });
  const moved = await db.prepare("SELECT COUNT(*) AS n FROM pitches p JOIN users u ON u.id = p.user_id WHERE u.handle = 'eve'").first();
  check("merging an account that has a pitch works and moves the pitch", r.status === 200 && moved.n === 1, `status ${r.status} ${JSON.stringify(r.data).slice(0, 100)}, moved ${moved.n}`);
  r = await eve.post("/api/mod/merge", { from: "bob", into: "eve", reason: "not a moderator at all" });
  check("only a moderator can merge", r.status === 403);
  r = await eve.get("/api/mod/reports");
  check("only a moderator sees the queue", r.status === 403);
  r = await owner.post("/api/auth/logout");
  check("sign-out ends the session", r.status === 200 && (await owner.me()) === null);
}

const bad = done();
await mf.dispose();
process.exit(bad ? 1 : 0);
