// The game Worker (builds-worker/worker.js): a hosted game is served, but can't install a service worker.
// How to run: see the top of rig.mjs (copy this file too, then: BC_ROOT=/path/to/repo node builds.mjs).
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = process.env.BC_ROOT || fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const mf = new Miniflare({
  modules: true, modulesRoot: ROOT, scriptPath: ROOT + "/builds-worker/worker.js",
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  compatibilityDate: "2025-09-01", d1Databases: { DB: "rig-db" }, r2Buckets: { BUILDS: "rig-bucket" }
});
const db = await mf.getD1Database("DB"), bucket = await mf.getR2Bucket("BUILDS");
const sql = readFileSync(ROOT + "/db/schema.sql", "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
for (const st of sql.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(st).run();
await db.prepare("INSERT INTO users (id, handle) VALUES ('u1', 'maker')").run();
await db.prepare("INSERT INTO projects (id, title, kind, genre, status, license, owner_id) VALUES ('game', 'Game', 'Game', 'Puzzle', 'help', 'MIT', 'u1')").run();
await db.prepare("INSERT INTO builds (id, project_id, status, created_by, created_at, version) VALUES ('b1', 'game', 'active', 'u1', '2026-11-16 00:00:00', 1)").run();
await bucket.put("builds/game/b1/index.html", "<!doctype html><title>Game</title>");
await bucket.put("builds/game/b1/sw.js", "self.addEventListener('fetch', () => {});");

let failed = 0;
function check(label, ok, detail = "") { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + label + (detail ? "   [" + detail + "]" : "")); }
const get = (path, headers = {}) => mf.dispatchFetch("https://game.brainwave.nexus" + path, { headers });

let r = await get("/");
check("the game's page is served", r.status === 200 && /Game/.test(await r.text()));
check("...with the game's restrictions", /frame-ancestors https:\/\/brainchild\.nexus/.test(r.headers.get("content-security-policy") || ""));
check("...and no cookie", !r.headers.get("set-cookie"));
r = await get("/sw.js");
check("a script file is served as an ordinary script", r.status === 200 && /javascript/.test(r.headers.get("content-type") || ""), "status " + r.status);
await r.text();
r = await get("/sw.js", { "service-worker": "script" });
check("the same file is refused as a service worker", r.status === 403, "status " + r.status);
await r.text();
r = await get("/assets/worker.js", { "service-worker": "script" });
check("...whatever the path", r.status === 403, "status " + r.status);
await r.text();
await db.prepare("UPDATE projects SET hidden_at = '2026-11-16 00:00:00' WHERE id = 'game'").run();
r = await get("/");
check("a removed project's game stops being served", r.status === 404, "status " + r.status);
await r.text();

console.log("\n" + (failed ? failed + " check(s) FAILED" : "all checks passed"));
await mf.dispose();
process.exit(failed ? 1 : 0);
