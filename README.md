# Brainchild (brainchild.nexus)

| Folder | What it is | How it's deployed |
|---|---|---|
| `site/` | The website: plain HTML, CSS and JavaScript, no build step | Built from GitHub by the Worker `royal-firefly-b80b` (see `wrangler.jsonc`) |
| `api/worker.js` | Read-only backend: the same Worker's script, answering `/api/*` | Deployed together with the site by the same push |
| `db/schema.sql` | Database structure for D1 `brainchild-db` | Already applied |

Only the **`site`** folder is served to visitors as files. `db/` is kept here as a record. Nothing in the repo is secret.

## Updating the website

Pushing to the `main` branch on GitHub redeploys the site and the API together, automatically (Cloudflare Workers Builds,
connected under **royal-firefly-b80b → Settings → Builds**). Wait about a minute, then refresh
https://brainchild.nexus. Cloudflare runs the build on its servers, so nothing needs installing locally.

## How it fits together

- Pages call `/api/projects` and `/api/projects/<id>` on the same domain. One Worker serves everything:
  requests to `/api/*` run `api/worker.js`, which answers from the D1 database; every other path is a
  static file from `site/` (`run_worker_first` in `wrangler.jsonc`).
- Responses are cached at Cloudflare's edge for 60 seconds to save database reads.
- If the API can't be reached (or you open the files locally), pages fall back to the sample list in
  `site/js/data.js`, so the site never shows up empty.
- Fonts (Bricolage Grotesque, Atkinson Hyperlegible, Martian Mono, Silkscreen) are self-hosted in `site/fonts/`
  under the SIL Open Font License; no visitor data goes to Google or other font services.
- All listing text is inserted with `textContent`, never `innerHTML`, so user-submitted text can't inject code.

## Cloudflare resources

| Resource | Name / ID | Notes |
|---|---|---|
| Worker | `royal-firefly-b80b` | Static assets plus `/api/*`, custom domain `brainchild.nexus`. Bindings: `DB` (D1), `BUILDS` (R2), `ASSETS` (the `site/` files) |
| D1 database | `brainchild-db` · `6e241536-91de-49b7-b885-35429bd01efb` | Tables: users, projects, packets, lineage, proposals, votes, posts. 19 sample projects, 1 sample packet |
| R2 bucket | `brainchild-builds` (ENAM, private) | Lifecycle rule deletes unfinished uploads after 24 h |

## API (v1, read-only)

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/projects` | `{ "projects": [...] }`, newest handoff first |
| `GET /api/projects/<id>` | `{ "project", "packet", "lineage" }` or 404 |

## What's still sample / placeholder

- The 19 listings, blog posts and community candidates are sample content.
- Sign in, "Hand off a project", Adopt/Fork, downloads and the proposal form don't save anything yet.
- Votes are remembered only in the visitor's own browser.
- Anything in `[brackets]` is a gap to fill.

## Next steps

1. **Sign-in** (email magic link or GitHub login) and user records in D1.
2. **Submit a project**: form → API → D1, with the build uploaded to R2. Limits: signed-in users only,
   size cap per project, per-user project cap, overall storage ceiling around 9 GB.
3. **Serve builds from a separate domain** (not brainchild.nexus) so uploaded code can't touch the main site.
4. **Votes and proposals** saved to D1, one vote per user per month.
5. Licence check and malware scan before anything is listed.
