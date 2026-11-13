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
| Builds | Hosted game builds are served by a second Worker, `brainchild-builds` (`builds-worker/`), on `brainwave.nexus` (zone `129edd4f3cddb7357da7ae5d2c2bcc8b`), one sub-address per game. Its routes `brainwave.nexus/*` and `*.brainwave.nexus/*` and the two DNS records are set in Cloudflare, not in the repo. The Workers Builds deploy command is `npx wrangler deploy && npx wrangler deploy --config builds-worker/wrangler.jsonc`, so one push deploys both Workers. |
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
2. **GitHub sign-in.** *Done 13 Nov and confirmed by the owner's first real sign-in the same day.* GitHub OAuth App with no scopes (read-only public information, no repo access). Code in
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
7. **Hosted browser builds.** *Done 13 Nov on `brainwave.nexus`; waiting on the owner's first upload.*
   - **Upload** (`api/builds.js`, `site/js/play.js`): on the project page the maintainer chooses the
     folder their build tool wrote (for example `dist`). Files go to R2 one at a time under
     `builds/<project>/<build>/`. Nothing is served until the build is made live, and it needs an
     `index.html` at its top level. Admin rights on the repo are re-checked with GitHub when an upload
     starts and when it goes live.
   - **Limits and file types** (`api/build-rules.js`): 25 MB a file, 100 MB and 400 files a build, 9 GB for
     all builds. Only the listed kinds of file are accepted, each is always served as the type on that
     list, and hidden files such as `.env` are refused.
   - **Origin** (`builds-worker/`): a second Worker, `brainchild-builds`, serves each game from its own
     sub-address, `<project id>.brainwave.nexus`. It has no sign-in code and never reads or sets cookies.
     A removed project's build stops being served. The bare domain shows a page linking back.
   - **What a game may do:** the response headers let it run its own files only. It can't contact other
     sites, submit forms, open pop-ups, or be framed anywhere except brainchild.nexus. Say if a game needs
     an outside service; that would be a per-game exception.
   - **Embedding:** the Play button puts the game in a sandboxed iframe (`allow-scripts allow-same-origin
     allow-pointer-lock`); `frame-src` allows `https://*.brainwave.nexus`.
   - **Not done:** cross-origin isolation headers, which some engines' threaded web exports need (Godot 4
     with threads); add them when a game needs them.
   - **First test:** the owner's Zombie Outbreak Simulator.
8. **Edit a project page** (requested by the owner 13 Nov). Do this before the items in step 9.
   - **Who and how:** add an "Edit page" button on the project page, shown only to the current maintainer.
     Re-run `requireRepoAdmin` on every save, not only when the page opens. Reuse the listing flow's
     fields and validation.
   - **Editable:**
     - Title, one-line description, genre, "built with" (tech), browser flag
     - The packet: works, broken, vision, agent context, provenance
     - Screenshots (already done)
     - Status, limited to choices that fit the maintainer's plans: Open for collaboration, Needs testers,
       Active or Archived. Moving to Up for adoption must go through the handoff flow, so the name and
       license questions are asked.
     - Content rating and notes. Every rating change is logged with the old and new values, and is visible
       to moderators.
   - **Not editable:**
     - Lineage and credit
     - Existing license snapshots. If the repo's license changed, take a new snapshot and add it to the
       License record history, keeping the old ones.
     - The repo link (a different repo means a transfer or a new listing)
     - The name-rights answer after a handoff
   - **Shown on the page:**
     - "Packet updated [date]" (packets.updated_at), so adopters can judge freshness
     - A short public change log: field names changed and when, not the old text
   - **Safety:** apply the same same-origin and CSRF checks as the other write routes. All text goes in
     with textContent.
9. **Then, in this order:**
   - **Discussion board.** *Done 13 Nov.* On the project page (`site/js/discussion.js`, `api/community.js`):
     comments with one level of replies, GitHub avatars, role labels (Maker, Original maker, Maintainer),
     "Helpful" marks, Top and Newest sorting. The maintainer can pin; authors can delete their own. Limit:
     10 comments per person per 10 minutes. Badges are returned as an empty list until Relay rounds exist.
     `avatars.githubusercontent.com` is in `img-src`.
   - **Report button and moderation queue.** *Done 13 Nov.* Signed-in people can report a project (link in
     the project page footer) or a comment, in the mockup's 7 categories (`POST /api/reports`).
     Moderators work the queue at `site/mod.html`. A removal is refused unless it carries a ground (house
     rules or illegal content) and written reasons; that statement of reasons is stored in
     `moderation_actions` and never deleted. The affected person reads it at `site/account.html` and can
     ask once for a review; a moderator then puts the content back or upholds the removal. Removing a
     project sets `projects.hidden_at`: the page, its API answers and its screenshots disappear, while
     lineage and license records stay. Moderators are listed by GitHub id in `api/auth.js`
     (`MODERATOR_GITHUB_IDS`, currently only the owner).
   - **Screenshot uploads.** *Done 13 Nov.* The maintainer adds up to 6 images per project from the project
     page (`api/screenshots.js`). PNG, JPEG and WebP only, judged by the file's first bytes; 2 MB each; SVG
     refused. Admin rights on the repo are re-checked with GitHub on every upload and delete. Images are
     served from `/api/screenshots/<id>` with a fixed image type and `nosniff`, cached for 5 minutes. The
     first screenshot shows on the project page and on cards.
   - **Blog votes.** *Done 13 Nov.* The blog page's vote and proposal form now use the database
     (`api/votes.js`, `site/js/blog.js`). During each calendar month (UTC) people propose and vote on next
     month's community project. Any project that is up for adoption can be proposed once per month, with a
     goal of 10 to 300 characters; each person can make three proposals a month and withdraw their own.
     One vote per person per month, enforced by the `votes` table's key; a vote can be changed or
     withdrawn until the month ends. Counts are not shown while voting is open. The hard-coded sample
     candidates are gone, so the page no longer depends on particular listings existing.
     Not built: choosing and announcing the winner at month end, and reporting a proposal's text (the
     report form covers projects and comments only).
   - Relay rounds last. The rules were decided on 13 Nov; see "Relay rules" below.
   Not in this queue and not built: the Mature gate from the Project mockup. Ratings and content notes are
   stored and shown in the project page's byline; the gate itself depends on the Open decision about
   German visitors.

## Waiting on the owner

1. **Sign-in works against the real GitHub** (the owner signed in at 16:23 GMT on 13 Nov: the session,
   the 8-hour token and its refresh token were stored, and no email). **Still to confirm:** while signed
   in, open https://brainchild.nexus/api/repos/blimeybruv/brainchild/access. It should show
   `"admin":true` and `"can_list":true`. If it shows `"admin":false`, tell the agent: that would mean
   GitHub hides admin rights from a token with no scopes, and the options for that need your decision.
2. **Then try listing a project** (the real test of steps 4 to 6): click **List a project**, choose
   `blimeybruv/zombie-outbreak-simulator`, and publish. It should update the existing Zombie Outbreak
   Simulator page rather than make a second one, and add a **License record** link under Details.
   Everything GitHub-facing in these steps has only been tested against a stand-in for GitHub.
3. **License copy lock: done 13 Nov.** The owner said yes. The R2 bucket `brainchild-builds` has a lock
   rule, `license-records` (prefix `licenses/`, indefinite). Objects there can't be deleted or overwritten
   until the rule is removed. `storeLicense` already skips existing keys, so nothing needs to change. Don't
   write anything under `licenses/` except license copies.
4. **Software Heritage: answered yes, 13 Nov. To build.**
   - **When:** at handoff (and at first listing), request an archive of the repo with Software Heritage's
     "save code now" API: `POST https://archive.softwareheritage.org/api/1/origin/save/git/url/<repo url>/`.
     Use `ctx.waitUntil` so the listing never waits on it or fails because of it.
   - **What to store:** the request id and status, then show a "Archived at Software Heritage" link on the
     License record page once the save succeeds.
   - **What to send:** only the public repo URL, nothing about the user.
   - **Rate limit:** anonymous requests are rate-limited, so queue and retry gently.
5. **Hosted builds: built 13 Nov on `brainwave.nexus`. Please try it:** on the Zombie Outbreak Simulator
   page, signed in, click **Upload a browser build** and choose the `dist` folder that `npm run build`
   made. When it finishes, click **Play in browser**. Tell the agent if the game doesn't start: its
   scripts are confined to its own address, which can trip a game that calls an outside service.
6. **Moderation and outside reports: answered 13 Nov.**
   - **Moderators:** only the owner, for now.
   - **Reporting without GitHub:** build a signed-out report form behind Cloudflare Turnstile, the free bot
     check. Create the widget through the API, and allow `challenges.cloudflare.com` in `script-src` and
     `frame-src` for the report form only, where the CSP can be scoped.
   - **What signed-out reports contain:** category, URL, reasons, and an optional reply-to address. The
     address is stored privately, never shown, and deleted when the case closes.
   - **Where they go:** into the same moderation queue, with a statement of reasons on any decision.
   - **Contact page:** add one saying how to report and that reports are reviewed by the operator. The
     owner's email must not appear anywhere.
7. **Analytics script: done 13 Nov.** `static.cloudflareinsights.com` is allowed in `script-src` and
   `cloudflareinsights.com` in `connect-src`.
8. **Optional tidy-up:** in Cloudflare, **Workers & Pages → royal-firefly-b80b → Settings → Build →
   Variables and secrets**, delete `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Those two are unused;
   the working copies are under **Variables and Secrets** higher up the same page. Leave those alone.

## Relay rules (decided by the owner, 13 Nov; confirmed again in chat the same evening)

A round lasts one calendar month. The Relay mockup shows the stages.

1. **Entry (week 1).**
   - Each person nominates one project they maintain. It must be listed on Brainchild and accept pull
     requests.
   - Minimum 4 entries. With fewer, the round doesn't run and the entries roll over to next month.
2. **Vote (week 1, after entry closes).**
   - Each entrant ranks three projects other than their own, scored 3, 2 and 1 points. Entrants can't rank
     their own project.
   - Ties go to whoever has more first places, then whoever entered first.
   - The highest total wins.
3. **Task board (within 3 days of the result).** The winning maintainer posts tasks. Contributors may take
   a task or bring their own idea, called a "wildcard".
4. **Contribute (the rest of the month).**
   - Every entrant except the winner must open at least one pull request on the winner's repo, checked
     through the GitHub API (PR author = the entrant's GitHub account, opened during the round).
   - A PR doesn't have to be merged to count, only real.
5. **Review.** The maintainer can flag a PR as junk. A moderator reviews each flag; if it's upheld, that PR
   doesn't count. Record a statement of reasons, as with other moderation decisions.
6. **Recap and badges.**
   - The maintainer awards **Most helpful contributor · Relay round [n]** and, optionally,
     **Best wildcard · Relay round [n]**. The maintainer can't award badges to themself.
   - Badges show on the user's page and next to their name in discussions.

**Consequences**
- **No counting PR:** an entrant with no counting PR (none, or only junk that was upheld) can't enter the
  next round. They may still contribute to it, and doing so restores eligibility for the round after.
- **Repeat wins:** allowed. A winning project may enter and win again the next month.
- **No badges:** if the maintainer awards none within 7 days of the round ending, the round still counts,
  contributors keep credit, and a moderator may award the badges.

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
- How Mature listings are handled for German visitors.
