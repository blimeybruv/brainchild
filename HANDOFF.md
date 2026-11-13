# Brainchild: handoff for the backend build

Written 12 Nov 2026 for the next agent session. The aim of that session is to make Brainchild real:
GitHub sign-in, ownership checks, listing and handoff flows, and license records.
The site's look is mostly settled; don't redesign it unless asked.

## What Brainchild is

brainchild.nexus is a free directory of AI-assisted ("vibe-coded") **games, mods and apps**. A maker either
**hands a project off** to someone new or **keeps it and invites help**. Every listing carries a
**handoff packet**: what works, what's broken, the vision, the agent context file (CLAUDE.md or AGENTS.md),
where each asset came from, and the license. Lineage records who made and maintained what.

Statuses (the database value is in brackets):
- Up for adoption (`adopt`)
- Open for collaboration (`help`)
- Needs testers (`test`)
- Active (`active`)
- Archived (`archived`)

The site's tagline is "Hand it off, or take it on." "Adopt" is the deliberate word for taking a project on.

## Where things live

| Thing | Where |
|---|---|
| Site | This repo. `site/` is served by the Worker `royal-firefly-b80b` on brainchild.nexus. Pushing to `main` redeploys it via Workers Builds (`wrangler.jsonc`). |
| API | `api/worker.js`, the main script of the same Worker. It handles `/api/*` first (`run_worker_first`) and passes everything else to the static files. Bindings: `DB` (D1), `BUILDS` (R2), `ASSETS`. It is read-only for now, with a 60s edge cache. |
| Database | D1 `brainchild-db` (`6e241536-91de-49b7-b885-35429bd01efb`). The schema is in `db/schema.sql`; changes are in `db/migrations/` and must be applied to both databases. It holds 19 sample projects plus one real one, `zombie-outbreak-simulator` (owner blimeybruv). |
| Storage | R2 `brainchild-builds` (private; incomplete uploads are deleted after 24h). |
| Caching | Public API answers tell browsers not to keep a copy (`max-age=0`) and let Cloudflare's edge keep one for 60s (`s-maxage=60`). Publishing and adopting clear the edge copies they affect. |
| Previews | Every branch other than `main` gets a preview build (`npx wrangler preview`), linked from its pull request. Previews use the test database `brainchild-db-preview` (`3b6e6ea2-8a4a-469c-9150-4dcbad16ab64`) and bucket `brainchild-builds-preview`, set in the `previews` block of `wrangler.jsonc`. Any binding added at the top level needs a matching entry there, and schema changes must be applied to both databases. |
| Designs | `design/mockups/*.dc.html`, exported from the design canvas on 9 Nov. The live canvas, which may be newer, is at https://claude.ai/artifact/DmMeLYto8YNwpSZcxNr9Mr |
| Secrets | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set on the Worker (dashboard, type Secret). The OAuth App's callback is `https://brainchild.nexus/api/auth/callback`, with wildcard matching off and expiring tokens on. Token encryption is keyed from the client secret, so replacing the secret makes everyone link GitHub again. |
| Spending | Cloudflare budget alerts are set. Keep everything within the free tiers. |

**Owner constraint:** the owner does not use Linux or Wrangler. Every deploy must happen by pushing to
GitHub (Workers Builds runs Wrangler on Cloudflare's side) or through the Cloudflare API.
Secrets, such as the OAuth client secret, are set by the owner in the dashboard; give exact click paths.

## Which mockup covers what

| File | Covers |
|---|---|
| `Main` | Home page and house rules |
| `Browse` | Filters (type, genre, status, mods by game, "Show Mature projects") |
| `Project` | Packet, license badges, discussion board with badges and avatars, Report dialog with 7 categories, Mature gate |
| `Handoff` | **The main spec for this session:** the maker and adopter flows |
| `License` | Public license record page: version switch, fingerprint, snapshot panel, history |
| `Blog` | Topics, monthly votes, proposal form |
| `Relay` | Relay rounds: entry, task board, contributions, review, recap with badges |
| `Fonts`, `Patterns`, `Logo`, `HeroFractal` | Visual options |

## Work for this session, in order

1. **Merge the API into the site Worker.** *Done 12 Nov.* `royal-firefly-b80b` has a main script, with
   `/api/*` handled first (`run_worker_first`) and D1 and R2 bindings in `wrangler.jsonc`, so one push
   deploys everything. The old `brainchild-api` route and Worker are deleted.
2. **GitHub sign-in.** *Done 13 Nov; waiting on the owner's first real sign-in (see "Waiting on the
   owner").* GitHub OAuth App with no scopes (read-only public information, no repo access). Code in
   `api/auth.js`:
   - `/api/auth/login` → GitHub → `/api/auth/callback`, with the state parameter and PKCE, both held in a
     10-minute `__Host-bc_oauth` cookie.
   - Sessions live in D1 (`sessions` table) behind the `__Host-bc_session` cookie (HttpOnly, Secure,
     SameSite=Lax, 30 days). The database stores only a hash of the cookie value.
   - GitHub tokens are stored encrypted and never reach the browser. They last 8 hours and are renewed
     with the refresh token (`githubToken()` in `api/github.js`).
   - `POST /api/auth/logout` needs a same-origin `Origin` header and revokes the token at GitHub.
   - `/api/me` returns only the handle and avatar. No email is requested or stored.
   - Sign-in works only on `https://brainchild.nexus`; previews answer "unavailable".
   - Every later route that changes data must check `isSameOrigin(request)` (in `api/http.js`).
3. **Ownership check.** *Done 13 Nov; same wait as step 2.* `requireRepoAdmin(env, session, owner, repo)`
   in `api/github.js` asks GitHub `GET /repos/{owner}/{repo}` with the user's token and passes only when
   `permissions.admin` is exactly `true` and the repo is public. **Call it inside every route that
   creates or changes a listing, and again inside the handoff route**; never reuse an earlier answer.
   `GET /api/repos/{owner}/{repo}/access` exposes the same check to the listing form.
4. **Listing flow (Handoff mockup, maker side).** *Done 13 Nov; untested against the real GitHub.* Page
   `site/list.html` (`site/js/list.js`), six steps: Start (staying or leaving, sign in), Choose repo,
   Ownership, License, Details, Publish. Backend in `api/listings.js`:
   - `GET /api/my/repos` feeds the repo picker; `GET /api/repos/{o}/{r}/listing-info` returns the admin
     check, the detected license and the repo's CLAUDE.md or AGENTS.md.
   - `POST /api/projects` publishes. With `dry_run: true` it checks everything and returns the generated
     "AI handoff rules" block without saving; the Publish step shows that preview.
   - The server re-checks ownership at publish, requires a license file, asks the name-rights question
     only of makers who are leaving, limits status to `adopt` (leaving) or `help`/`test` (staying), and
     requires `base_game` for mods.
   - A details step was added to the mockup's five, because the mockup has no place for the title, type,
     genre and packet fields.
   - An owner who lists a repo that already has a pre-sign-in listing (matched on the repo address)
     updates that listing in place; it gains its repo id and license record. Nobody else can.
   - Judgment calls the owner may want to change: a license file GitHub doesn't recognise is accepted and
     shown as "Custom license"; one account can hold at most 25 listings.
5. **License snapshot and record page.** *Done 13 Nov, apart from the two optional items below.* Publishing
   and adopting each add a row to `license_records` with the commit SHA, the SPDX id and a SHA-256
   fingerprint of the license text, read at that exact commit. A copy of the text goes to R2 under
   `licenses/<fingerprint>`, so it is stored once and never overwritten by different content. Rows are
   only ever added. Record page: `site/license.html?id=<project>` (`GET /api/projects/<id>/license`,
   `GET /api/license-text/<fingerprint>`), with a version switch, an in-browser fingerprint check, the
   snapshot panel and the history.
   Rules encoded (all in `api/listings.js`):
   - Releases made under the earlier license can't be taken back: records are append-only.
   - Adopters may relicense permissive code: recorded as a new `relicense` version.
   - GPL code stays GPL: adoption is refused if a GPL, AGPL or LGPL project's new copy has a different license.
   - Apache-2.0 grants no name or trademark rights: said in the form, the rules block and the record page.
   Not done (see "Waiting on the owner"): the R2 bucket lock and the Software Heritage archive request.
6. **Adopter flow.** *Done 13 Nov; untested against the real GitHub.* Page `site/adopt.html?id=<project>`
   (`site/js/adopt.js`), reached from the project page's Adopt button. `POST /api/projects/<id>/adopt`:
   - Only projects with status `adopt`; the adopter must be an admin of the repo they link.
   - Fork: GitHub's `parent` field must be the project's repo. Transfer (only if the maker offered it):
     the linked repo must have the same GitHub id as the project's repo.
   - The maker's name rule is enforced (`rename` needs a new title; `continuation` must keep the old name).
   - Lineage: the previous entry gets an end date and a new one is added; nothing is deleted.
   - The project becomes `active` under the adopter, and the page shows the rules block to paste into
     CLAUDE.md or AGENTS.md. If two people adopt at once, exactly one succeeds.
   - Left out from the mockup because nothing in this queue covers them: notifying the maker of a transfer
     request, verifying Codeberg or GitLab repos with a file, opening a pull request with the rules block
     (that would need repo write access), and storing a source archive.
7. **Hosted browser builds.** The "Play in browser" button currently links to the repo
   (`site/js/project.js`).
   - **Upload:** makers upload a static build (e.g. a Vite `dist/`) to R2.
   - **Origin:** serve every build from a **separate origin**, never brainchild.nexus or a subdomain of
     it, because a game is arbitrary JavaScript and must not be able to reach the session cookie. Options
     are a second cheap domain or a `*.workers.dev` Worker; ask the owner which.
   - **Embedding:** embed it in a sandboxed iframe (`allow-scripts`, plus `allow-same-origin` only on that
     separate origin), and allow that origin in `frame-src`.
   - **Limits:** set size caps and scan file types.
   - **First test:** the owner's Zombie Outbreak Simulator. Its `npm run build` gives a static `dist/`
     with a Web Worker, and it is fine at the domain root.
8. **Then, in this order:**
   - Discussion board with comments, badges and GitHub avatars (add `avatars.githubusercontent.com` to
     `img-src` in `site/_headers`).
   - Report button feeding a moderation queue. Record a statement of reasons for each removal (EU DSA
     notice-and-action).
   - Screenshot uploads to R2: images only, with a size cap.
   - Blog votes (one per user per month, already in the schema). Note: `site/js/blog.js` hard-codes three
     sample listing ids and the page throws if any of them is missing from the database; fix that here.
   - Relay rounds last.

## Waiting on the owner

1. **Try sign-in once** (needed to confirm steps 2 and 3 against the real GitHub):
   - Open https://brainchild.nexus, click **Sign in**, and approve Brainchild on GitHub. You should land
     back on the site with your avatar, `@blimeybruv` and **Sign out** in the header.
   - Then open https://brainchild.nexus/api/repos/blimeybruv/brainchild/access. It should show
     `"admin":true` and `"can_list":true`.
   - This is the first real test: the agent's sandbox can't reach github.com, so everything up to the
     jump to GitHub was checked live, and everything after it only against a stand-in for GitHub.
   - If sign-in shows "Sign-in didn't work", or the second page shows `"admin":false`, tell the agent.
     The second case would mean GitHub hides admin rights from a token with no scopes, and the options
     for that need your decision.
2. **Then try listing a project** (the real test of steps 4 to 6): click **List a project**, choose
   `blimeybruv/zombie-outbreak-simulator`, and publish. It should update the existing Zombie Outbreak
   Simulator page rather than make a second one, and add a **License record** link under Details.
   Everything GitHub-facing in these steps has only been tested against a stand-in for GitHub.
3. **Lock the stored license copies?** Cloudflare R2 can lock the `licenses/` folder so the copies can't be
   deleted or overwritten by anyone, including you, until the lock is removed. It makes the records
   stronger evidence, but a file stored by mistake couldn't be removed without lifting the lock first.
   Say yes or no; the agent can set it through the Cloudflare API.
4. **Ask Software Heritage to archive each handed-off repo?** It is a free public archive. It would mean
   Brainchild sends the repo's address to a third party at handoff. Say yes or no.
5. **Optional tidy-up:** in Cloudflare, **Workers & Pages → royal-firefly-b80b → Settings → Build →
   Variables and secrets**, delete `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Those two are unused;
   the working copies are under **Variables and Secrets** higher up the same page. Leave those alone.

## Rules that must hold

- Build the DOM with `textContent` only; never put user text into `innerHTML`.
- Keep the CSP in `site/_headers` strict. Fonts are self-hosted, with no requests to Google or other font services.
- **No sexually explicit content, including nude mods.** This keeps the site out of age-verification
  regimes (the UK Online Safety Act and others). Mature means violence or strong themes, not sex.
- **Historical symbols in mods** (e.g. WW2 strategy mods such as Darkest Hour): allow them, but behind a
  declared flag and the Mature or "historical symbols" notice. Germany allows them in games under the
  social adequacy rule, but plan for a region notice.
- A mod's license covers only the modder's own files; the game's EULA still applies. Mods require `base_game`.
- Credit is never removed from lineage.

## Decided

- **Fonts (Option A):** Bricolage Grotesque for headings (weight 800), Atkinson Hyperlegible for body text,
  Martian Mono for code, and Silkscreen for pixel accents. Option B is held in reserve.
- **Background:** brushed metal with a faint chip-lattice pattern.
- **Hosting:** screenshots and builds are hosted on Brainchild (R2), not only in repos.

## Open (ask the owner; don't decide)

- Logo: the C cradling a B, with the B drawn as a brain or as nerd glasses. The owner has their own sketches.
- Hero background: the Julia, smoke or contour option from `HeroFractal`.
- Exact Relay rules.
- How Mature listings are handled for German visitors.
