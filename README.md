# Brainchild (brainchild.nexus)

| Folder | What it is | How it's deployed |
|---|---|---|
| `site/` | The website: plain HTML, CSS and JavaScript, no build step | Built from GitHub by the Worker `royal-firefly-b80b` (see `wrangler.jsonc`) |
| `api/worker.js` | Read-only backend: the same Worker's script, answering `/api/*` | Deployed together with the site by the same push |
| `builds-worker/` | The Worker that serves hosted game builds on `brainwave.nexus` (Worker `brainchild-builds`) | Deployed by the same push, after the site |
| `db/schema.sql` | Database structure for D1 `brainchild-db` | Already applied |

Only the **`site`** folder is served to visitors as files. `db/` is kept here as a record. Nothing in the repo is secret.

## Updating the website

Pushing to the `main` branch on GitHub redeploys the site and the API together, automatically (Cloudflare Workers Builds,
connected under **royal-firefly-b80b → Settings → Builds**). Wait about a minute, then refresh
https://brainchild.nexus. Cloudflare runs the build on its servers, so nothing needs installing locally.

Every other branch gets a **preview**: Cloudflare builds it and posts a preview link on the pull request.
Previews run the same code against the test database and bucket (the `previews` block in
`wrangler.jsonc`), never the live ones.

## How it fits together

- Pages call `/api/projects` and `/api/projects/<id>` on the same domain. One Worker serves everything:
  requests to `/api/*` run `api/worker.js`, which answers from the D1 database; every other path is a
  static file from `site/` (`run_worker_first` in `wrangler.jsonc`).
- Responses are cached at Cloudflare's edge for 60 seconds to save database reads.
- If the API can't be reached (or you open the files locally), pages fall back to the sample list in
  `site/js/data.js`, so the site never shows up empty.
- Fonts (Bricolage Grotesque, Atkinson Hyperlegible, Martian Mono, Silkscreen) are self-hosted in `site/fonts/`
  under the SIL Open Font License; no visitor data goes to Google or other font services.
- Sign-in is through GitHub and asks for no permissions beyond public information. Brainchild keeps the
  GitHub handle and avatar, never an email address. The session cookie can't be read by page scripts.
- All listing text is inserted with `textContent`, never `innerHTML`, so user-submitted text can't inject code.

## Cloudflare resources

| Resource | Name / ID | Notes |
|---|---|---|
| Worker | `royal-firefly-b80b` | Static assets plus `/api/*`, custom domain `brainchild.nexus`. Bindings: `DB` (D1), `BUILDS` (R2), `ASSETS` (the `site/` files) |
| D1 database | `brainchild-db` · `6e241536-91de-49b7-b885-35429bd01efb` | Tables: users, sessions, projects, packets, lineage, license_records, comments, comment_likes, reports, moderation_actions, screenshots, builds, proposals, votes, posts. 19 sample projects, 1 sample packet |
| R2 bucket | `brainchild-builds` (ENAM, private) | Holds the stored license copies under `licenses/` screenshots under `screenshots/` and hosted builds under `builds/`. Lifecycle rule deletes unfinished uploads after 24 h |
| Builds Worker | `brainchild-builds` | Serves `brainwave.nexus` and `*.brainwave.nexus`. Bindings: `DB` (read only), `BUILDS`. No workers.dev address |
| Preview D1 database | `brainchild-db-preview` · `3b6e6ea2-8a4a-469c-9150-4dcbad16ab64` | Test copy used only by pull-request previews. Same tables and sample rows as the live database |
| Preview R2 bucket | `brainchild-builds-preview` (ENAM, private) | Used only by pull-request previews. Same lifecycle rule |

## API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/projects` | `{ "projects": [...] }`, newest handoff first |
| `GET /api/projects/<id>` | `{ "project", "packet", "lineage" }` or 404 |
| `GET /api/auth/login` | Sends the visitor to GitHub to sign in, then back to the page they were on |
| `POST /api/auth/logout` | Signs out |
| `GET /api/me` | `{ "user": { "handle", "avatar_url" } }`, or `"user": null` when signed out |
| `GET /api/my/repos` | The signed-in user's public GitHub repos, for the listing form |
| `GET /api/repos/<owner>/<repo>/listing-info` | Ownership, detected license and agent file for one repo |
| `POST /api/projects` | Publishes a listing (signed-in admins of the repo only) |
| `POST /api/projects/<id>/adopt` | Takes a project on, by fork or transfer |
| `GET /api/projects/<id>/license` | The public license record: every release with its commit and fingerprint |
| `GET /api/license-text/<fingerprint>` | The stored copy of a license file |
| `GET`/`POST /api/projects/<id>/comments` | The project's discussion; posting needs sign-in |
| `POST /api/comments/<id>/like`, `/pin`, `/delete` | Mark helpful (anyone signed in), pin (maintainer), delete (author) |
| `POST /api/reports` | Report a project or a comment |
| `GET /api/mod/reports`, `POST /api/mod/reports/<id>/resolve`, `POST /api/mod/actions/<id>/appeal` | Moderation queue (moderators only) |
| `GET /api/my/notices`, `POST /api/my/notices/<id>/appeal` | Decisions about your own posts, and your reports |
| `POST /api/projects/<id>/screenshots`, `POST /api/screenshots/<id>/delete` | Add or remove a screenshot (maintainer only) |
| `GET /api/screenshots/<id>` | A screenshot image |
| `POST /api/projects/<id>/builds`, `PUT .../builds/<build>/files?path=`, `POST .../builds/<build>/activate`, `POST /api/projects/<id>/builds/remove` | Upload, publish or take down a hosted browser build (maintainer only) |
| `GET`/`POST /api/votes` | This month's community-project vote; one vote per person |
| `POST /api/proposals`, `POST /api/proposals/<id>/delete` | Propose a project for the vote, or withdraw your proposal |
| `GET /api/repos/<owner>/<repo>/access` | Whether the signed-in user is an admin of that GitHub repo (the rule for listing it) |

## What's still sample / placeholder

- The 19 listings, blog posts and community candidates are sample content.
- Hosted builds play from `https://<project>.brainwave.nexus/`, a separate domain, so a game's code can't
  reach Brainchild's pages or sign-in. Downloads don't work yet, and the blog posts are samples. Sign-in, listing a project, the license
  record, adopting a project, discussion, reports and moderation, screenshots, and the monthly vote work.
- Anything in `[brackets]` is a gap to fill.

## Next steps

1. See `HANDOFF.md` for the current work queue; the list below is the older outline.
2. **Submit a project**: form → API → D1, with the build uploaded to R2. Limits: signed-in users only,
   size cap per project, per-user project cap, overall storage ceiling around 9 GB.
3. **Serve builds from a separate domain** (not brainchild.nexus) so uploaded code can't touch the main site.
4. **Votes and proposals** saved to D1, one vote per user per month.
5. Licence check and malware scan before anything is listed.
