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
| Database | D1 `brainchild-db` (`6e241536-91de-49b7-b885-35429bd01efb`). The schema is in `db/schema.sql`; changes are in `db/migrations/` and must be applied to both databases. Since 17 Nov it holds only real data: one project, `zombie-outbreak-simulator` (owner blimeybruv). The preview database (`3b6e6ea2-8a4a-469c-9150-4dcbad16ab64`) still has the 19 sample projects for testing. |
| Storage | R2 `brainchild-builds` (private; incomplete uploads are deleted after 24h). |
| Caching | Public API answers tell browsers not to keep a copy (`max-age=0`) and let Cloudflare's edge keep one for 60s (`s-maxage=60`). Publishing and adopting clear the edge copies they affect. |
| Previews | Every branch other than `main` gets a preview build (`npx wrangler preview`), linked from its pull request. No pull request is needed to see it: the branch `claude/handoff-step-1-hhjfyd` is always at `https://claude-handoff-step-1-hhjfyd-royal-firefly-b80b.blimeybruv.workers.dev` (about a minute after a push; check a changed `?v=` number to be sure it's the new build). The live site updates about a minute after a push to `main`. Previews use the test database `brainchild-db-preview` (`3b6e6ea2-8a4a-469c-9150-4dcbad16ab64`) and bucket `brainchild-builds-preview`, set in the `previews` block of `wrangler.jsonc`. Any binding added at the top level needs a matching entry there, and schema changes must be applied to both databases. |
| Builds | Hosted game builds are served by a second Worker, `brainchild-builds` (`builds-worker/`), on `brainwave.nexus` (zone `129edd4f3cddb7357da7ae5d2c2bcc8b`), one sub-address per game. Its routes `brainwave.nexus/*` and `*.brainwave.nexus/*` and the two DNS records are set in Cloudflare, not in the repo. It has its own Workers Builds trigger (root `/builds-worker`, runs when `builds-worker/*` or `api/build-rules.js` changes on `main`), so a push deploys whichever Worker changed. **Never add a second `wrangler deploy` to the site's deploy command:** Workers Builds forces the connected Worker's name, so on 13 Nov that put the builds code on the site Worker for about 20 seconds until it was rolled back. If Cloudflare opens a pull request renaming the Worker in `builds-worker/wrangler.jsonc`, close it without merging. |
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
   The R2 bucket lock and the Software Heritage archive request were added on 13 Nov (see "Waiting on the
   owner", items 3 and 4).
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
     request, verifying GitLab repos with a file, opening a pull request with the rules block
     (that would need repo write access), and storing a source archive.
7. **Hosted browser builds.** *Done 13 Nov on `brainwave.nexus`. The owner uploaded Zombie Outbreak
   Simulator the same evening and it plays on its project page.*
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
   - **Checked live on 13 Nov** with a temporary test build on a sample listing (since removed): it played
     inside the project page from its own sub-address, and the framed page was refused access to the
     Brainchild page. Cloudflare's analytics script is injected into game pages too and is blocked there
     by the game's own restrictions; that is intended.
   - **Versions:** see "Updating hosted builds" below.
   - **Play area:** a running game gets most of the window's height (not the 16:9 preview box) and the
     page scrolls it into view. The first upload showed why: the game's Start button was cut off.
   - **Not done:** cross-origin isolation headers, which some engines' threaded web exports need (Godot 4
     with threads); add them when a game needs them.
   - **First test:** the owner's Zombie Outbreak Simulator.
8. **Edit a project page.** *Done 13 Nov.* The maintainer sees an **Edit page** button on the project page
   (`site/edit.html`, `site/js/edit.js`, `POST /api/projects/<id>/edit` in `api/listings.js`).
   - **Editable:** title, one-line description, genre, built with, browser flag, the packet, status (Open
     for collaboration, Needs testers, Active, Archived), content rating and notes. Screenshots and the
     browser build stay on the project page.
   - **Every save** re-runs `requireRepoAdmin`, checks same-origin, and validates with the listing rules.
   - **Rating changes** are logged with old and new values in `project_changes` and listed for moderators
     on `site/mod.html`.
   - **License:** each save compares the repo's license file with the last snapshot. If it changed, a new
     `license_change` record is added and the earlier ones are kept. A repo with no license file can't
     be saved. A GPL-family project that has passed to another maintainer can't change license; its
     original maker (the only lineage entry) may.
   - **Not editable:** lineage, existing license records, the repo, type, base game, and the name-rights
     answer.
   - **Up for adoption** can't be chosen in the editor. The page links to the listing flow
     (`list.html?intent=leave&repo=...`), which now accepts the maintainer's own listed project: it asks
     the license and name questions, starts from the page's current content, puts the project up for
     adoption in place and adds a `handoff` license record. A maintainer can also withdraw from adoption
     by choosing another status in the editor.
   - **Shown on the project page:** "updated [date]" beside the packet heading, and a "Recent changes"
     panel listing field names and dates only.
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
     The month's winner and reporting a proposal were added on 14 Nov (see below).
   - **Relay rounds: done 14 Nov** (rules: "Relay rules" below). Built in three parts:
     - **Part A, done 14 Nov:** rounds, entries and the ranked vote (`api/relay.js`, `site/relay.html`,
       `site/js/relay.js`, linked from the main navigation).
       - Timetable in UTC: entry on days 1 to 5, ranking on days 6 and 7, result on day 8. The rules say
         "week 1" for both entry and vote; this split is the agent's choice and easy to change
         (`ENTRY_LAST_DAY`, `VOTE_LAST_DAY`).
       - Entering needs a project the person maintains with a verified, unarchived repo; GitHub is asked
         at that moment. One project per person per round.
       - Fewer than 4 entries by the end of day 5: the round doesn't run and its entries are carried into
         next month's round. Rounds that ran are numbered 1, 2, 3 and so on.
       - Only entrants rank, three projects other than their own, for 3, 2 and 1 points. Rankings can be
         changed until voting closes and totals stay hidden until then. Ties: more first places, then the
         earlier entry.
       - Nothing runs on a timer: a round moves to its next stage the first time someone opens the page
         after the stage's date has passed.
     - **Part B, done 14 Nov:** the month of work (`api/relay-board.js`, migration `0012`).
       - **Task board.** Only the person who entered the winning project posts and removes tasks (up to
         20, each with a short label). Anyone else signed in can say "I'm working on this". The board is
         open until the month ends. The "within 3 days" date is shown but not enforced, because the rules
         don't say what happens if it's missed.
       - **Contributions.** Anyone signed in except the winner submits a pull request link (or just its
         number), a task or "wildcard", and a sentence on what they tried. GitHub is asked at that
         moment: the PR's author must be the signed-in GitHub account, its base must be the winner's repo
         (matched by repo id, so a renamed repo still works), and it must have been opened during the
         round's calendar month (UTC). Merged or not doesn't matter. Up to 5 each; each PR once.
         A PR opened in the month can still be submitted during the review week.
       - **Junk flags.** The winning maintainer flags a contribution with one of four reasons (no real
         change, spam, auto-generated with no effort, ignored the instructions) and an optional note.
         A flag does nothing by itself. It appears in the moderation queue (`mod.html`), where a
         moderator agrees (reasons required) or clears it. An upheld flag writes a `moderation_actions`
         row (`target_type = 'relay_pr'`), so the contributor reads the statement of reasons on
         `account.html` and can ask once for a review; "restore" there makes the PR count again.
       - The public page shows that a contribution is flagged or doesn't count, but the reason is shown
         only to the contributor, the maintainer and moderators.
       - A flag still waiting for a moderator does **not** stop the PR counting. Only an upheld one does.
       - A moderator can't decide a flag they raised themself. With one moderator (the owner), a flag the
         owner raises on their own winning project stays open, so that PR keeps counting. See "Waiting on
         the owner".
       - The mockup's "Accept" button was left out: under the rules a PR counts unless a flag is upheld,
         so accepting would change nothing.
       - **Stages after the month.** A round moves to `review` when its month ends and to `closed` after
         the 7th of the next month, again the first time someone opens the page. Earlier rounds are
         reachable at `relay.html?month=2026-12` and linked under "Other rounds".
     - **Part C, done 14 Nov:** the end of a round (`api/relay-badges.js`, migration `0013`,
       `site/user.html`).
       - **Recap.** Once the month is over the round's page shows a recap: how many pull requests from
         how many contributors, the badges, how many flags are still waiting, and (once the round has
         closed) the entrants with no pull request that counts.
       - **Badges.** During the review week the winning maintainer picks Most helpful contributor and,
         optionally, Best wildcard, with buttons under each contribution. They can change or take back a
         pick until review ends; after that the picks are final. A badge only goes to a pull request
         that counts, Best wildcard only to a wildcard, and never to the person awarding it. If a flag on
         a badged pull request is later upheld, the badge goes with it.
       - **Moderator fallback.** If the maintainer awarded none by the time the round closes, a
         moderator may award them from the same page. A moderator's award is final and is shown as such.
       - **Where badges show.** On the round's page at once. On the member's page
         (`user.html?u=<handle>`, public, from `GET /api/users/<handle>`) and beside their name in
         discussions only once the round has closed. Names in discussions and on the Relay page link to
         the member's page, which lists badges, Relay contributions and the projects they maintain.
       - **No counting pull request.** An entrant other than the winner with no pull request that counts
         for a round can't enter a later round until they have a counting contribution in some round
         after it. A flag that is still waiting doesn't count against them. The entry form explains this
         instead of offering the form.
       - A moderator can't decide a flag on their own pull request, the same as with a flag they raised.
       - Not built: an announcement or blog post for the recap, and any notification to entrants. The
         site sends no email, so people have to look at the page.
   The Mature gate was built on 15 Nov, once the owner decided it (see "the Mature gate" below).

**The queue above is finished (14 Nov), and so are the owner's requests of 14 Nov (15 Nov), apart from
what waits on the owner.** What is left:

- **Blog vote winner: done 14 Nov.** The blog page now opens with "Community project · <month>": the
  proposal that won the vote held during the previous month, with its goal, proposer and vote count, and
  a link to join in on the project page (`current` in `GET /api/votes`). Choices the agent made: a tie
  goes to the proposal made first (as in Relay rounds), and with no votes at all there is no community
  project that month. Nothing is stored: the result is worked out when the page asks, since closed votes
  can't change. A project a moderator removes drops out of the result. The first result will appear on
  1 Dec, from the votes cast in November.
- **Reporting a blog proposal: done 14 Nov.** Each proposal on the blog page has a Report control
  (signed out, it opens the report form). A report has `target_type = 'proposal'` and a `proposal_id`
  (migration `0014`, which rebuilt the `reports` table to allow the new type; the two existing reports
  were copied over unchanged). On the Moderation page the proposal's text is shown; "Remove it" sets
  `proposals.removed_at`, so the proposal leaves the vote and its votes stop counting, while the project
  itself stays listed. The proposer gets the statement of reasons on their account page and can ask once
  for a review; restoring puts the proposal back. A removed proposal can't be withdrawn by its proposer,
  so the record stays. The Report control offers four categories that fit a proposal's text
  (harassment, spam, sexual content, something else).
- **Launch clean-up: done 17 Nov** (see "Owner requests, 14 Nov", step 2). The site shows only real
  listings and posts.
- **Only if a listed game needs it:** cross-origin isolation headers on the builds Worker, for engines
  that use threads (some Godot and Unity web exports). No listed game needs them today.
- **Mature gate: done 15 Nov.** Only the German age label waits on the owner (item 12 below).
- **Needs real people, not code:** adoption, edit page saves, discussion and moderation actions,
  screenshots, blog votes, build rollback and Relay rounds have only been exercised by tests.

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
4. **Software Heritage: done 13 Nov** (`api/archive.js`). When a project is listed, handed off or adopted,
   Brainchild asks Software Heritage to archive the repo, sending only its public address. The request
   goes out after the page has answered, so a listing never waits on it or fails because of it. Requests
   are kept in `archive_requests`. Unfinished ones are retried or looked up at most once every ten
   minutes, when someone opens the project's license record, and a send is tried five times at most. The
   License record page shows "Archived at Software Heritage" with a link once it succeeds. A request was
   queued for the Zombie Outbreak Simulator record that existed before this was built.
5. **Hosted builds: done and confirmed 13 Nov.** The owner's upload of Zombie Outbreak Simulator is live
   at `zombie-outbreak-simulator.brainwave.nexus` and plays from its project page.
6. **Moderation and outside reports: done 14 Nov. Please try the form once** (see the last point).
   - **Moderators:** only the owner, for now.
   - **Report form** (`site/report.html`, `api/outside.js`): anyone can report a page on brainchild.nexus
     or a game on brainwave.nexus without an account. It asks for a category, the page's address, reasons
     and an optional reply-to address, behind Cloudflare Turnstile. The Turnstile widget "Brainchild
     report form" was created through the API; its secret is the Worker secret `TURNSTILE_SECRET` and its
     public key is in `api/outside.js`. Only `/report` may load `challenges.cloudflare.com` (a scoped rule
     in `site/_headers`). No IP address is stored. At most 40 outside reports an hour are accepted.
   - **Reply-to address:** stored in `outside_reports.reply_to`, shown only to moderators on the queue
     while the case is open, and set to NULL the moment the case is closed, whatever the decision.
     Brainchild sends no email itself; the operator replies by hand if they choose to.
   - **Queue:** outside reports appear on `site/mod.html` above the others. If the address points at a
     project, the moderator can remove it, which needs a ground and written reasons and records the same
     statement of reasons as any other removal. Otherwise they close it as "dealt with another way" or
     dismiss it, with a note.
   - **Contact page** (`site/contact.html`): how to report with and without an account, what happens to a
     report, and where to ask other questions. No email address appears. Every page's footer links to it
     and to the report form; a signed-out visitor who clicks "Report this project" is pointed to the form
     with the page's address filled in.
   - **Confirmed 14 Nov:** the owner sent a test report from a real browser at 20:53 GMT and it was stored
     (outside report 1, open, no reply-to), so the real Turnstile check works. Close it from the
     Moderation page when convenient.
7. **Analytics script: done 13 Nov.** `static.cloudflareinsights.com` is allowed in `script-src` and
   `cloudflareinsights.com` in `connect-src`.
8. **Optional tidy-up:** in Cloudflare, **Workers & Pages → royal-firefly-b80b → Settings → Build →
   Variables and secrets**, delete `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Those two are unused;
   the working copies are under **Variables and Secrets** higher up the same page. Leave those alone.
9. **Relay junk flags with one moderator (no action needed yet).** A moderator can't decide a flag they
   raised themself, or a flag on their own pull request. While the owner is the only moderator, a flag
   the owner raises on a contribution to their own winning project, or a flag someone raises on the
   owner's pull request, can't be reviewed by anyone, so that pull request keeps counting. Adding a
   second moderator fixes it: give the agent their GitHub username and it adds their id to
   `MODERATOR_GITHUB_IDS` in `api/auth.js`.
12. **The German age label: answered 15 Nov (option b) and built.** The question was: The age-label guides say `default-age` in
    `/age-de.xml` should be the highest age on the domain (18 here), because it's what filters use when
    they can't read a page's own label. With the site default at 0 as decided, a filter that misses a
    Mature page's label would let it through. The guides also differ on the meta label's format (one
    includes a "hash" code), and the official spec PDF wasn't reachable to settle it. Choose one:
    - **(a) As decided:** default 0, and an 18 label on each Mature project page.
    - **(b) Spec-safe:** default 18, with a 0 label on every page except Mature projects, which keep 18.
      Same result for visitors; safer if a label isn't read.
    - **(c) Hold it** until someone checks the official spec (online-management-kontor.de / FSK).
    The page labels need the Worker to add a tag to `project.html` for Mature listings (a small change).
11. **GitLab on the live site: linking confirmed 15 Nov.** The owner linked their GitLab account to their
    Brainchild account at 20:31. The live database shows both sign-ins on one account, the GitLab
    account's age and public-activity check were recorded, and the session holds a GitLab token, so the
    whole real sign-in works: token exchange, profile and project lookup. Still untested with real data:
    - Signing in with **Continue with GitLab** from signed out (it should land on the same account).
    - Optional: if you have a public GitLab project, try **List a project**, choose **GitLab.com**, and
      check that it appears with a "Maintainer" label.
    - Self-hosted GitLab and the moderators' "Merge two accounts" tool (foot of the Moderation page) are
      also live; only the stand-in has tested them.
10. **Relay rounds are finished and live; the first real round opens on 1 Dec.** Nothing in them has been
    used by real people yet. The pull request check has only run against a stand-in for GitHub, so the
    first real contribution is the real test: if GitHub refuses the lookup, the person sees "GitHub
    didn't answer" and nothing is stored. Three timetable choices were the agent's and are easy to change
    if you'd like them different: entry on days 1 to 5, ranking on days 6 and 7, and "opened during the
    round" meaning during the calendar month (UTC).

## Updating hosted builds (owner request 13 Nov; done 14 Nov)

- **Upload a new version** at any time from the project page or the Edit page (the same control,
  `site/js/play.js`). Admin rights on the repo are re-checked with GitHub when the upload starts, when it
  goes live and on a rollback. The same size caps and file-type checks apply.
- **The new version replaces the live one** at the game's sub-address. The version before it is kept
  (`builds.status = 'previous'`) and anything older is deleted, so a game holds two versions at most.
- **Roll back** with one click (`POST /api/projects/<id>/builds/rollback`). It swaps the live and kept
  versions, so rolling back again returns to the newer one.
- **Under the player:** "Version N · uploaded [date] · repository was at commit [sha]". The commit is the
  repo's latest commit when the upload started; nobody declares what the build was actually built from.
- **Players get a new version straight away.** No purge is needed: the builds Worker looks up the live
  build on every request, files its edge copies under that build's id, and tells browsers to check before
  reusing a file (`cache-control: no-cache` with an ETag, answering 304 when unchanged).

## Owner requests, 14 Nov: dead links and launch clean-up

1. **Dead links.** *Done 14 Nov.* No visible link points to `#` any more: About (`site/about.html`) and
   the Licensing guide (`site/licenses.html`) are written and in every footer; "List a project" in the
   headers goes to `list.html`; "Pitch a post" goes to a new "Writing for the blog" section on the
   contact page (pitches come in through the report form as "Something else", since there is no other
   route to the operator); "Submit a mod" already worked. On the project page the main button now goes to
   the adoption page, the game, or the repo's issues or fork page, "Just fork it" is hidden when there is
   no GitHub repo, and "Download packet" serves the maker's packet as a Markdown file
   (`GET /api/projects/<id>/packet.md`; there is no zip). The sample blog posts' "Read the post" links,
   which had nowhere to go, became a "Sample post" note. The original request read:
   Many links still point to `href="#"` and jump to the top of the page. Find them all with
   `grep -n 'href="#"' site/*.html`. "Source" now points to the GitHub repo.
   - **About:** write `site/about.html`, covering what Brainchild is, how handing off and adopting work,
     the house rules and the contact page. Keep it short and in the site's plain tone.
     - **Include the reason the site exists:** too much AI-assisted software is made once, shared, and
       never looked at again. Brainchild is for the opposite: handing projects on, adopting them,
       improving them together (Relay rounds), and packets that let the next person or agent pick up
       where the last one stopped.
     - Put it in the site's own words. Don't quote or name other platforms.
   - **Licensing guide:** write `site/licenses.html`, a plain guide to the licenses the site accepts
     (reuse the license badge tooltip text). Cover what each one allows, that earlier releases can't be
     withdrawn, relicensing (permissive code yes, GPL stays GPL), Apache-2.0 and the project name, assets
     under CC licenses, and that a mod's license covers only the modder's own files. End with "not legal
     advice".
   - Also fix "List a project" on adopt.html, "Pitch a post" on blog.html and "Submit a mod" on
     browse.html, and update the footer on every page.
2. **Before launch (do it when the owner says the site is ready):**
   - Delist every sample project: everything in D1 except real listings, currently only
     `zombie-outbreak-simulator`. Delete or hide the rows, together with their packets and lineage.
   - Empty or remove the sample fallback in `site/js/data.js`, so an API failure shows "No projects yet"
     instead of fake ones.
   - Remove the sample blog posts and proposals.
   - Remove the sample Relay round for `2026-10` (id 2, with its entries, votes, tasks, contributions and
     badges), the sample Blog proposals and votes for month `2026-11` (proposal ids 6–8), and the `sample-*` users (`u-sample-ada` … `u-sample-finn`), added 14 Nov as a demonstration.
   - Ask the owner first, and list what will go.
   - **Done 17 Nov (owner: "You can kill the sample pages").**
     - **Code:** `site/js/data.js` no longer holds sample listings; every page uses `/api/projects`. The
       project page's built-in "Moss Keeper" sample packet is gone, and an unknown or missing `?id=` says
       "That project isn't here" instead of showing a sample. The sample blog posts are gone (the blog shows
       "No posts yet" and points to Pitch a post). "Sample listings shown" was removed from Browse and home.
     - **Placeholders replaced with real data:** the home page's "CONTINUE?" card (was hard-wired to Moss
       Keeper) shows a listing up for adoption, otherwise a featured or the newest one, and hides when
       there are none. The featured list falls back to the newest listings while nothing is featured.
       The project page's "Before you adopt" checklist (was five fixed ticks) now shows the real license
       record, hosted build, how many packet sections are filled, provenance and verification. The static
       "[original-maker]" byline and lineage placeholders and the "AI tools [as tagged by maker]" row are
       gone; "Repo" links to the real repository.
     - **Database (production only; the preview database keeps its samples for testing):** deleted on
       17 Nov: the 19 sample projects (and Moss Keeper's packet, the only sample with one), the six
       `sample-*` accounts, the sample Relay round for `2026-10` (id 2: 5 entries, 15 votes, 4 tasks, 5
       contributions, 2 badges), and Blog proposals 6–8 with their 6 votes. There were no sample posts,
       comments or screenshots in the database. **Kept:** `zombie-outbreak-simulator` with its packet,
       lineage, license record, builds and archive request; the owner's account, sign-ins and sessions;
       the reports; and Relay round 1 (`2026-11`). Nothing pointed at a sample account afterwards.
     - **To undo:** D1 Time Travel can put the whole database back to just before the deletion, bookmark
       `0000011e-00000000-00005126-11fcaa34d647734b277262c51e5d482a` (this would also undo anything real
       written since, so ask the owner first; Time Travel keeps 7 days on the free plan, so after 24 Nov
       this no longer works). The preview database holds the same 19 projects.

## Owner request, 14 Nov: GitLab sign-in, and linked accounts

**Codeberg is dropped (owner's decision, 14 Nov).** Support GitHub and GitLab only. Don't build Codeberg sign-in or Codeberg verification, and refuse Codeberg repo URLs in the listing flow with a plain message.

**Verifying non-GitHub repos.** This replaces the file-only plan as the main route.
- **Sign-in:** add OAuth sign-in for **GitLab.com**. Guide the owner
  through registering the app (free) and adding the secrets in the dashboard, with exact click paths.
- **Admin checks:**
  - GitLab: the project member access level must be 50 (Owner) or 40 (Maintainer).
  - Re-check on every edit, handoff and adoption, exactly like `requireRepoAdmin`.
- **Self-hosted GitLab only:** keep the verification-file method (a code committed to the
  repo). Label those listings "verified: push access", and require a fresh file at handoff.

**Progress, 15 Nov (batch 10).**
- **Done: GitLab.com sign-in and linked accounts** (`api/auth.js`, `api/gitlab.js`, `api/identities.js`,
  migration `0015`, `site/signin.html`, the Sign-ins section of `site/account.html`).
  - The owner registered the GitLab app (scopes `read_user read_api`, return addresses for the site and
    the branch preview) and saved `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET` as Worker secrets on 14 Nov.
  - "Sign in" now opens a page with "Continue with GitHub" and "Continue with GitLab". Pages that need
    GitHub (listing, adopting, editing) still go straight to GitHub until GitLab projects can be listed.
  - `identities` holds each sign-in; everyone who had signed in with GitHub was copied in. `users.github_id`
    stays, so the moderator list (by GitHub id) works as before.
  - Handles: a new GitLab account takes its GitLab username, with `-gl` added if someone here already has
    it. An account with a GitHub sign-in keeps following its GitHub username.
  - **Security fix on the way:** a GitHub sign-in could claim any account whose handle matched and that had
    no GitHub id. It can now only claim a pre-seeded record with no sign-in of any kind, so a GitLab
    account can't be taken over by someone registering the same name on GitHub.
  - Linking: account page, "Link a GitHub/GitLab account". If that sign-in already has its own account
    and that account has never been used (no projects, comments, votes, reports, Relay activity, builds,
    screenshots or moderation records), it is folded in; otherwise the person is told to ask a moderator.
    One sign-in per provider per account. Linking again ("Connect for this session") just refreshes the
    token on the current session.
  - Unlinking works except for the last sign-in, and drops that provider's tokens from every session.
  - GitLab avatars are shown only when uploaded to gitlab.com (`img-src` now allows `https://gitlab.com`).
    Gravatar addresses are never stored, because they contain a hash of the person's email address.
  - The public member page lists linked usernames only when the person ticks the box on their account
    page; it always shows each project's platform.
  - GitLab tokens expire after two hours and are refreshed like GitHub's (`api/gitlab.js`), sealed
    separately from the GitHub ones, and revoked at sign-out.
- **Done: GitLab.com projects** (`api/forge.js`, migration `0016`).
  - `api/forge.js` answers every repository question for both hosts: who manages it, the head commit,
    the license file at that commit, the CLAUDE.md or AGENTS.md, and the person's own repositories.
    Listing, editing, handing off, adopting, hosted builds and screenshots all ask it, so the same
    rules apply on both sites.
  - The GitLab check is the person's role on the project, counting roles inherited from groups
    (`/projects/:id/members/all/:user`): Maintainer (40) or Owner (50). Private projects can't be listed.
    Nested groups (`group/sub/project`) work.
  - The license text is read at the exact commit from the root `LICENSE`, `LICENCE` or `COPYING` file;
    its SPDX id comes from GitLab's detection on the default branch, mapped from GitLab's keys.
  - A repo is now identified by `(repo_host, repo_id)`. The unique index changed to match, because a
    GitLab project and a GitHub repo can have the same number. `license_records` and `lineage` also
    record the host, so records and credits link to the right site.
  - The listing form has a "GitHub / GitLab.com" choice. If the account isn't linked to that site, or its
    token has lapsed, it offers "Connect GitLab" (or GitHub), which links it and comes back.
  - Adoption: the adopter's copy must be on the same site as the project. GitLab forks are proved with
    `forked_from_project`; transfers keep the project id.
  - Codeberg addresses get "Codeberg isn't supported"; other self-hosted addresses get "Only projects on
    GitLab.com can be listed for now".
  - Relay rounds: see below (GitLab.com projects can enter since 15 Nov; self-hosted ones can't).
- **Done 15 Nov: the manual merge tool** (`api/merge.js`, migration `0017`, "Merge two accounts" at the
  foot of the Moderation page).
  - The moderator types the account to fold in and the account to keep, previews both (sign-ins and a
    count of everything each has done), writes a reason and confirms. Every merge is recorded in
    `account_merges`, and the last 20 are returned with each preview.
  - Everything the folded-in account did moves to the kept one in a single database batch: projects,
    lineage, license records, comments, reports, votes, Relay activity, badges, builds, screenshots and
    moderation records. Its sign-ins move too, its sessions end and the account is removed.
  - Refused when both accounts have a sign-in from the same site, or when both entered (or both ranked
    in) the same Relay round. A blog vote in the same month, a like on the same comment or a claim on
    the same task is kept from the account that stays.
  - How to be sure both accounts are the same person is left to the moderator; the page suggests asking
    them to confirm while signed in to each.
- **Done 15 Nov: self-hosted GitLab** (`api/forge.js`, migration `0018`, "Self-hosted GitLab" in the
  listing form).
  - The maker enters the project's https address and presses "Get a verification code". They commit the
    code to `brainchild-verify.txt` at the top of the default branch, then press "check". Brainchild reads
    the instance's public API with no token, so the project must be public and the instance reachable.
  - Codes belong to one person and one repository, last 7 days, and are used up by a listing, a handoff or
    an adoption, so each of those needs a new one. Edits, builds and screenshots accept any code issued to
    the current maintainer for that repository, so the file must stay in the repo.
  - The project page says "✓ verified: push access" instead of "verified owner".
  - Each instance is its own host (`repo_host = 'selfhosted:<hostname>'`), so ids can't collide between
    instances. An adopter's copy must be on the same instance, with their own code in it.
  - **Safety:** Brainchild's server only fetches `https://<public host name>`: no IP addresses, no
    ports, no user names in the address, no `localhost`, `.internal`, `.local` and similar names, and it
    doesn't follow redirects. Answers are size-capped. Links come from Brainchild, never from the
    instance's own `web_url`.
  - Self-hosted projects can't enter Relay rounds: Brainchild can't check who opened a merge request there.
- **Done 15 Nov: Relay rounds for GitLab.com projects.** They can be entered (checked on GitLab like
  any other change). For a GitLab winner, a contribution is a merge request: a link, `!12` or just the
  number, always looked up on the winner's own project. Its author must be the contributor's linked
  GitLab account, and it must have been opened during the round's month. A contributor without a linked
  GitLab account is asked to connect one. Self-hosted GitLab projects still can't enter, because
  Brainchild can't check who opened a merge request there.
- **The GitLab request is complete.** What's left is for the owner to try it on the live site (see
  "Waiting on the owner").

**Linked accounts.**
- **Accounts:** one Brainchild account per person (handle, badges, comments, lineage, votes), with any
  number of linked sign-ins. Add an `identities` table (provider, provider_user_id, handle,
  linked_at) referencing `users`.
- **Linking:** only from the account page, while signed in, by completing the other provider's sign-in.
  **Never link by matching email.** No emails are stored.
- **Repo checks stay per platform:** a GitLab project needs the GitLab token at the time of the action.
  Linking never bypasses a check.
- **Second sign-in already has an account:** if it has no activity, merge it automatically. Otherwise
  refuse and show "contact a moderator", and add a manual merge tool to the moderation area.
- **Unlinking:** allowed, except for the last remaining sign-in. Lineage and credit belong to the
  person and never change.
- **Privacy:** the profile shows linked accounts only if the user opts in. By default it shows just the
  platform of each listed project.

## Owner request, 14 Nov: vote-rigging signals and a privacy page

**Signals: done 15 Nov** (`api/signals.js`, migration `0019`, "Signals worth a look" on the Moderation page).
- Account age (Brainchild), linked account age and "nothing public" (no public repositories, gists or
  GitLab projects, checked at each sign-in) are shown for anyone who voted or took part in a Relay round
  while their network flag is still on record, when their Brainchild account is under 14 days old, the
  linked account is under 30 days old, or nothing is public.
- Network flags are recorded on blog votes, Relay entries and Relay rankings. The key is derived per vote
  or round from the existing GitHub client secret, so the owner adds nothing; that also means the same
  network gives different hashes in different votes, which is the "rotation". Withdrawing a vote or an
  entry removes its flag. Rows expire 30 days after the vote or the round's voting closes, and expired
  rows are deleted whenever a moderator opens the queue.
- Moderators see sentences such as "3 votes in the blog vote for December 2026 came from one network"
  and account ages, never hashes or addresses.

**Privacy page: done 15 Nov** (`site/privacy.html`, linked in every footer). It covers what is stored and
why, the network check, signed-out reports, the two cookies (session, and the ten-minute sign-in cookie),
Cloudflare's cookieless analytics, who else is involved (Cloudflare, GitHub and GitLab, Software
Heritage), how long things are kept, and how to ask for a copy or deletion (report form or Contact; a
moderator confirms it's really them).
- It promises that deleting an account removes the sign-ins, the profile and what the person posted,
  while license records and lineage stay. **There's no deletion tool yet:** a moderator would have to do
  it by hand in the database. If requests come in, a "Delete account" tool for moderators is the next
  step; ask the owner first.

- **Cheap signals first.** Show moderators these on votes, Relay entries and new accounts:
  - the age of the linked GitHub or GitLab account, and whether it has any public activity;
  - the age of the Brainchild account.
- **Hashed network flag.** Collect it only for votes and Relay entries.
  - Store an HMAC (secret key, rotated) of the requester's network: the IPv4 /24 or IPv6 /64, from
    `CF-Connecting-IP`. **Never store the raw IP.**
  - Delete these 30 days after the round or vote closes.
  - Moderators see flags only ("3 votes in this round came from one network"), never addresses.
  - A flag means "worth a look". Never penalise automatically.
- **Privacy page.** Write `site/privacy.html` and link it in the footer. Plain language, covering:
  - what is stored (GitHub or GitLab id and handle, no emails, the hashed network flag and why,
    the optional private reply-to address on signed-out reports);
  - how long each is kept and the cookies used (session only);
  - that analytics is Cloudflare's cookieless analytics;
  - how to ask for deletion. Contact goes through the contact page; never show the owner's email.

## Owner decision, 14 Nov: "Mod / plugin" and "Made for"

**Done 15 Nov.** Only wording changed (`kind = 'Mod'` and `base_game` stay). `BC.kindLabel()` in
`common.js` shows "Mod / plugin" wherever the type appears (cards, the project page, the listing form's
type list, the blog). Browse's filter says "Mods & plugins", the side box "By what it's made for", and the
link "Submit a mod or plugin". "Mod for X" is "Made for X" everywhere, and the "Made for" field has the
new hint. The handoff rules block, the license record page, About, the Licensing guide and the home page's
house rules use the same wording. (`mod.html` is the Moderation page, so it has no mod wording to change.)

Widen the Mod type to cover plugins and extensions for any software (browser extensions, editor plugins
and so on), not only game mods. **Change only the wording; keep the stored values** (`kind = 'Mod'`,
column `base_game`), so there is no migration and the CHECK constraint stays as it is.
- **Type label:** "Mod" becomes **"Mod / plugin"**: the listing type picker, filters, cards, badges and
  the Edit page.
- **Field label:** "Base game" becomes **"Made for"**, with hint text such as "The game or program it
  runs in, e.g. Darkest Hour, Firefox, VS Code". The rule about the game's own terms becomes "Your
  license covers only your own files; the terms of what it's made for still apply."
- **Other wording:**
  - "Mod for X" becomes "Made for X".
  - Browse's "Mods by game" becomes **"By what it's made for"**.
  - "Submit a mod" becomes "Submit a mod or plugin".
  - The mod page (`mod.html`) gets the same wording.
- **Licensing guide and About:** say mods and plugins follow the same rule.
- **Check everything:** grep for "Mod", "mod for", "base game" and "game's own terms" across `site/` and
  `api/` error messages.

## Owner request, 14 Nov: moderator blog posts, and "Pitch a post"

**Done 15 Nov** (`api/posts.js`, migration `0020`, `site/mod-posts.html`, `site/post.html`).
- **Editor:** Moderation page → "Blog posts and pitches". Write, edit, publish, unpublish and delete posts,
  with topic, title, excerpt, body and author. A live preview uses the same renderer as the public page.
- **Formatting:** blank line between paragraphs, `# ` and `## ` headings, `- ` list items, `` `code` ``
  and `[text](https://...)` links (http and https only, `rel="nofollow noopener noreferrer"`). The text is
  stored as typed and turned into page elements in the browser (`BC.renderPost` in `common.js`), never
  HTML: a `<script>` in a post shows as text.
- **Author:** a member's handle, or empty for a site post shown as "Brainchild". Naming someone is refused
  unless they are the person whose pitch or report the post came from, or the moderator ticks "The named
  author submitted this or agreed to be named". The editor shows that reminder.
- **Audit:** every create, edit, author change, publish, unpublish and delete is logged with the
  moderator and time (`post_edits`), listed at the foot of the editor page and never shown on posts.
- **Pitch a post:** the blog sidebar has a signed-in form (topic, title, draft; three a day). Pitches
  wait on the editor page; "Make it a draft" copies the text as written, with the pitcher as author,
  and "Decline" sends an optional note. Members see their pitches on their account page (waiting, being
  edited, published with a link, or not taken up with the note). The contact page now points there.
- **Reports into drafts:** reports and outside reports with text have "Turn into a draft post", which
  opens the new draft in the editor. A signed-in reporter, who submitted the text, becomes the author;
  outside reports start as site posts. The report itself stays open.
- **The blog page** lists published posts, each linking to `post.html?slug=…`. With none, it says "No
  posts yet" and points to Pitch a post (the sample posts were removed 17 Nov).

- **Post editor (moderators only):** a page in the moderation area to create, edit, publish, unpublish
  and delete blog posts.
  - **Fields:** topic (the four existing topics), title, excerpt and body.
  - **Body formatting:** a small safe subset (paragraphs, headings, lists, links, `code`), rendered by
    building DOM nodes. **Never innerHTML.** Allow http(s) links only, and add `rel="nofollow noopener"`.
- **Author field:** any existing user, chosen by handle, or "Brainchild" for site posts. Moderators can
  change the author on an existing post.
  - **Audit:** privately log who actually created or edited the post and when, visible in the
    moderation area, not on the post.
  - **Consent:** only attribute a post to someone who submitted it or agreed to it. The editor shows a
    reminder of that, and stores a "submitted by" link to the pitch or report it came from.
- **"Pitch a post"** (currently a dead link on blog.html): a signed-in form (topic, title, the draft
  text) that creates a draft in the moderation queue, so guides don't have to come in through the report
  system.
  - From the draft, a moderator can edit it and publish it, with the pitcher as the author.
  - The pitcher sees what happened on their notices page, like reports.
  - The text goes in as-is; the moderator edits it before publishing.
- **Reports that are really submissions:** in the moderation queue, add a "Turn into a draft post"
  action. It copies the text and links back to the report.

## Owner decision, 14 Nov: the Mature gate (unblocked)

**Progress, 15 Nov.**
- **Done: the gate.** On a Mature project's page the game area and screenshots are covered by a notice
  (the content notes, the Mature criteria, "Show it" and "Go back"), as in the Project mockup. "Show it"
  is remembered for the browser session (`sessionStorage`), and so is Browse's new **Show Mature projects**
  box. Mature projects are hidden from Browse and the home page's featured list unless it's ticked.
  The description, packet and discussion stay visible.
- **Done: the criteria** are on the listing and Edit pages (owner), on About, in Browse's filter and in
  the gate notice (`BC.RATINGS` in `common.js`).
- **Done: "Change rating…"** on project reports in the Moderation queue: the moderator picks the rating
  and notes and writes the reasons (migration `0021`). It records a moderation decision with the old and
  new rating, answers open "wrong rating" reports about the project, shows under "Rating changes", and
  tells the maintainer on their account page. They can ask once for a review; "Restore the maker's
  rating" puts the old rating back.
- **Postponed, waiting on the owner: the German age label (`/age-de.xml` and the page meta label).** See
  "Waiting on the owner".

- **Same gate for everyone:** build the click-through gate from the Project mockup for Mature projects.
  The notice lists the content notes, with a "Show it" button that remembers the choice for the session.
  Browse keeps hiding Mature projects unless "Show Mature projects" is ticked. No country detection and no
  ID checks.
- **Age label:** add the machine-readable label for German youth-protection software. Serve
  `/age-de.xml` labelling the site default as 0 (all ages) and Mature project pages (`/project.html?id=…`
  for Mature listings, or a path pattern if easier) as 18. Also add the `age-de-meta-label` meta tag
  on Mature project pages. Keep it simple; if a path-level label isn't possible for query-string pages,
  label at page level with the meta tag.
- **Rating criteria (owner's decision, 14 Nov):** the listing and Edit pages now describe each tier
  concretely.
  - **Everyone:** no violence beyond cartoon or slapstick, no blood, no swearing.
  - **Teen:** combat and non-graphic violence, mild blood, horror themes and jump scares, moderate
    language, drug or alcohol references, war strategy.
  - **Mature:** realistic or graphic violence and gore, strong language throughout, drug use shown,
    disturbing themes.
  - Reuse this wording on the About page and in the Mature gate notice. Moderators can re-rate a listing
    that doesn't match: add a "Change rating" action to the moderation queue, with a statement of reasons
    and a notice to the maintainer.
- **Age label: option (b), decided 15 Nov.**
  - The site-wide default in `/age-de.xml` is **18**.
  - Every page carries a **0** label, except Mature project pages, which carry 18.
  - **Inject the label server-side.** `project.html` is one static file for every project, and filters read
    the raw HTML, not what JavaScript renders. So the site Worker must add the per-page label to the HTML
    response, e.g. with HTMLRewriter, after looking up the project's rating. Never set it from client-side JS.
  - Use the OMK v3.0 format linked in Opus's note. Where the guides disagree, follow the OMK document.
  - **Done 15 Nov.**
    - `site/age-de.xml` follows the OMK age-de.xml v3.0g document (its "Attachment 5" example):
      `default-age` 18, `htmlmeta` true, and an htmlmeta definition for `brainchild.nexus`. `age-issuer`
      is `brainchild.nexus`, since the site labels itself.
    - Every page has `<meta name="age-de-meta-label" content="age=0 info=https://brainchild.nexus/age-de.xml
      v=1.0 area=brainchild.nexus protocol=all">` in its HTML (format from section 15.2). The OMK document
      has no "hash"; that came from a different guide, so it isn't used.
    - `/project` and `/project.html` now go through the site Worker (`run_worker_first` in `wrangler.jsonc`).
      For a Mature listing it rewrites that tag to `age=18` with HTMLRewriter and sends `no-cache`, so a
      re-rating takes effect at once. If the rating can't be read, the page says 18.
    - **Added by the agent, same rule:** each hosted game (`<project>.brainwave.nexus`) is its own domain, and
      youth-protection software reads `age-de.xml` per domain. The builds Worker now answers `/age-de.xml`
      on every game's address with `default-age` 18 for Mature projects (and for anything not listed) and 0
      otherwise; a game's own uploaded `age-de.xml` is never served. The bare `brainwave.nexus` says 0.
    - Not used: the `X-content-age` HTTP header (section 14). It must only go on HTML pages, which the
      static `_headers` file can't single out cleanly; the meta label covers every page.
- **Fallback:** if a complaint ever arrives, hiding Mature listings for `CF-IPCountry: DE` is the
  fallback. Don't build it now.
- **"Historical symbols" is dropped (owner's decision):** it's removed from content notes in `list.js`
  and `edit.js` and from the About page's house rules. `api/listings.js` still accepts the old value so
  existing rows stay valid; don't show it anywhere.

## Security and privacy review, 16 Nov

One pass over every route, looking at how the separately built pieces interact. Each fix below was
reproduced first and then checked against a local copy of the Worker with a stand-in for GitHub, GitLab
and a self-hosted GitLab. Nothing here has run against the real services yet. The checks are kept in
`tests/review/` (`holes.mjs` for the site, `builds.mjs` for the game Worker; how to run them is at the
top of `rig.mjs`); they are not part of any deploy.

**Fixed (branch `claude/trusting-hypatia-js9nvz`):**
- **A moderator's rating now holds.** The Edit page and the handoff flow both let the maintainer set the
  rating back after a moderator's "Change rating", which dropped the Mature notice and the 18 age label.
  Until an appeal restores the maker's rating, the maintainer can raise the rating or add content notes
  but not lower it or remove the moderator's notes (`belowModeratorRating` in `api/listings.js`, error
  `rating_set_by_moderator`).
- **A removed project's license copy is taken down.** `/api/license-text/<fingerprint>` served the text
  whatever happened to the project, cached for a year, and the bucket lock means a copy can't be
  deleted. It is now served only while a listed project's record points at it, cached for 5 minutes.
- **Accounts with no sign-in can't be claimed by name.** A GitHub sign-in used to take over any account
  record that had no sign-in and a matching handle (until 17 Nov the six `sample-*` accounts; later, any account
  whose sign-ins were removed on deletion). That path is gone from `accountFor` in `api/auth.js`.
  **Keep it gone:** an account-deletion tool must not leave a claimable record behind.
- **Linking must start on this site.** `?link=1` is a plain link, so another site or a hosted game could
  send a signed-in visitor's browser to it and have their GitHub or GitLab account linked without asking.
  The start of linking now requires the navigation to come from a Brainchild page (`startedOnThisSite`).
- **Ownership re-checks are about the same repository.** GitHub and self-hosted GitLab were asked by
  name only. A maintainer who had transferred the repo away could create a new one under the old name
  and keep passing the check. `requireProjectAdmin` now also compares the host's permanent id (error
  `repo_changed`). A maintainer who deletes and re-creates their repo is stopped by this too; a moderator
  has to fix that listing by hand.
- **Self-hosted GitLab answers** are read only up to the size limit (they were read in full and measured
  afterwards) and each request is given up on after 8 seconds. Brainchild's own addresses can't be
  entered as an instance.
- **The sign-in page** no longer sends an already signed-in visitor to another site when `return_to`
  starts with a slash and a backslash.
- **Project ids** that read like part of the site (`login`, `admin`, `www`, anything starting with
  `brainchild`) get the owner's name added, since the id is also the game's sub-address.
- **Expired network codes and sessions** are deleted on ordinary page views (`sweepExpired`, at most
  every ten minutes), not only when a moderator opens the queue or someone signs in.
- **Headers:** HSTS (180 days), `object-src 'none'` and `frame-ancestors 'none'` added in `site/_headers`.
- **Smaller:** merging or auto-joining an account that had only pitched a post or edited one failed with
  a server error (those tables are now in `ACTIVITY`); the old preview address is no longer accepted for
  GitLab sign-in; the privacy page says the GitLab permission could read private projects and that
  profile pictures load from GitHub or GitLab.

**Decided by the owner, 16 Nov, and done:**
- **Games can't install a service worker.** One would keep answering at the game's address for people
  who had already opened it, after a moderator removed the game, a new version went live or the project
  was adopted by someone else. `builds-worker/worker.js` refuses any request a browser marks as a
  service worker's script. A game exported as an installable web app loses that feature; say so if a
  maker asks. The owner's Zombie Outbreak Simulator doesn't use one.
- **Per-request logs are off** on both Workers (`"logs": { "invocation_logs": false }` in both
  `wrangler.jsonc` files), so Cloudflare no longer keeps a log line for every request and the privacy
  page's "no IP address is stored" holds. Errors and the Workers' own `console.error` lines are still
  kept. Turn it back on only for a short debugging session, and tell the owner.

**Waiting on the owner:**
1. **GitLab permission (explained to the owner 16 Nov; no change made).** `read_api` is the narrowest
   GitLab scope that shows a person's role on a project, but it also covers their private projects, so
   the stored GitLab token is worth more to a thief than the GitHub one (which sees only public
   things). The privacy page now says so. The alternative is to ask GitLab without the person's token
   (public projects show their members) and request only `read_user`; GitLab may rate-limit that.
2. **GitLab app:** remove the line
   `https://claude-handoff-step-1-hhjfyd-royal-firefly-b80b.blimeybruv.workers.dev/api/auth/gitlab/callback`
   from the app's redirect URIs and keep `https://brainchild.nexus/api/auth/gitlab/callback`.
3. **Launch clean-up: done 17 Nov**, including the six `sample-*` accounts.
4. **Erasure and the license lock.** A license copy can be hidden but not deleted while the bucket lock is
   on. If someone asks for a text to be erased, the lock rule has to be lifted for that one object.

**Known and left as they are:**
- Adopting by fork is first come, has no undo and no per-person limit; a moderator can't reverse one
  without editing the database.
- Games share one cookie jar across `*.brainwave.nexus`. Adding `brainwave.nexus` to the Public Suffix List
  would separate them.
- Build storage (9 GB in all) can be filled by two or three accounts; license copies are permanent.
- The 40-an-hour cap on signed-out reports is shared by everyone, so a flood can close the form for an hour.
- Screenshots are stored as uploaded, including any location data inside a photo.
- License texts and packets are the maker's own text and can contain an email address.
- A removed project's title still shows on the Relay round it won and on badges earned for it.
- `caches.default.delete` only clears the copy in the data centre that handled the request; others
  expire by themselves within 60 seconds (5 minutes for screenshots and license copies).

## Owner request, 17 Nov: better license detection, and a fix-it panel

Background: the owner's mod (`resistance-dh-mod`) had the full MIT text plus a scope paragraph at
the top of LICENSE. GitHub returned NOASSERTION, so the listing showed "Custom". This will recur.

1. **Our own matcher, used when GitHub returns `other` / `NOASSERTION`, or no license.**
   - **Fetch the file:** fetch LICENSE (or LICENSE.md / COPYING) at the listed commit.
   - **Normalise:** lowercase, collapse whitespace, strip punctuation differences and quote styles,
     and remove the copyright line(s).
   - **Match:** check whether the full canonical text of a supported license is contained in it (MIT,
     MIT-0, 0BSD, BSD-2/3, ISC, zlib, Apache-2.0, MPL-2.0, GPL-2.0/3.0, LGPL, AGPL, Unlicense, CC0, the CC
     BY family). Store the canonical texts in the repo; don't fetch them at runtime.
   - **If the file is the canonical text alone:** treat it as that license.
   - **If there's extra wording:** show the maker the extra paragraph(s) and ask, "Does this text only
     explain what the license covers, or does it add conditions?"
     - "Only explains": list it as that license, mark the snapshot "with a note", and keep the extra text
       in the snapshot and on the License record page.
     - "Adds conditions": list it as **Custom**, and show the extra wording prominently on the License
       record and project page.
     - Never silently treat a modified license as standard.
   - **Run it wherever a license is detected:** at listing, on every Edit save (the existing re-snapshot
     logic), and at handoff or adoption.
2. **Fix-it panel in the listing flow (step 4)** when no supported license is recognised:
   - Explain the usual cause in plain words: extra text inside the LICENSE file, or no license.
   - **The fix:** keep LICENSE as the plain standard text, and put notes about scope in the README.
   - **Copy buttons** with the standard text of the common licenses, year and the maker's name filled in.
     This doubles as the template for repos with no license.
   - **Split licenses:** "Put the code license in LICENSE and the art license in a separate file (e.g.
     LICENSE-ART.md)", tied to the existing assets license step.
   - **A "Check again" button** that re-fetches the license without restarting the flow.
   - Brainchild never gets write access, so it can't commit the fix for them.
3. **Licensing guide:** add a short "Why does my license show as Custom?" section with the same advice.

**Done 17 Nov** (all three parts; migration `0022`, applied to both databases).
- **The matcher** is `api/license-match.js`. The standard texts are in `site/license-texts/` (from
  choosealicense.com, the texts GitHub's own detection uses). The Worker bundles them, so nothing is fetched
  at runtime, and the same files serve the copy buttons. Supported: MIT, MIT-0, 0BSD, BSD-2/3-Clause, ISC,
  Zlib, Apache-2.0, MPL-2.0, GPL-2.0/3.0, LGPL-2.1/3.0, AGPL-3.0, Unlicense, CC0-1.0, CC-BY-4.0 and
  CC-BY-SA-4.0.
  - **How it matches:** both texts are normalised: lower case, no punctuation, quote styles or markup,
    "licence" read as "license", http and https treated alike. List markers ("2.", "(a)", "iv.") and single
    letters are dropped everywhere, because they move when a text is rewrapped. Copyright lines ("Copyright
    (c) 2026 …", "© 2026 …", "All rights reserved") and the Free Software Foundation's address are set
    aside.
  - **What counts as a match:** the license's whole standard text must appear in order. The only gaps
    allowed are a few known varying phrases, such as BSD-3's "the copyright holder" and an old FSF address.
    A changed or missing sentence means no match.
  - **What isn't extra wording:** the title (e.g. "The MIT License (MIT)"), the license's own heading, its
    "How to apply" appendix (GNU, Apache), the CC preamble and a matching SPDX line. Anything else outside
    the match is extra wording, kept as written, in paragraphs.
  - **Tests:** 46 cases on canonical, rewrapped and modified texts. The owner's original
    `resistance-dh-mod` LICENSE (commit d38560b) comes out as MIT plus the one scope paragraph.
- **Where it runs:** `fetchLicense` in `api/forge.js` calls it whenever GitHub or GitLab gives no license
  name (`NOASSERTION`/other). When GitHub finds no license, LICENSE, LICENSE.md, LICENSE.txt and COPYING are
  looked for by name first. `settleLicense` in `api/listings.js` then decides what is recorded, at listing,
  handoff, every Edit save (the re-snapshot logic) and adoption:
  - **Standard text alone:** recorded as that license, `detection = 'matched'`.
  - **Standard text plus wording:** the request is refused with `license_question` (409), carrying the
    paragraphs, until the form sends `license_answer: { fingerprint, answer }`. The answer is tied to the
    file's fingerprint, so a changed file is asked about again.
    - "explains": that license, `with_note`, wording kept in `extra_text`.
    - "conditions": Custom (`spdx_id` NULL), `detection = 'conditions'`, `base_spdx` = the license found.
  - **More than one standard text in the file** (say MIT and CC BY together): Custom,
    `detection = 'several'`. *Choice the agent made:* it isn't asked about; the fix-it panel recommends
    splitting the files. An LGPL file that also carries the GPL text counts as LGPL.
  - **Older Custom records:** an Edit save whose unchanged file the matcher now recognises adds one new
    snapshot recording that. Earlier records are never changed.
- **The listing form, step 4:** the question shows the wording and two choices ("It only explains" /
  "It adds conditions"). Continue stays off until it's answered.
  - **Fix-it panel:** shown when nothing is recognised, or there's no LICENSE. It explains the usual cause
    (or names the licenses when there are several), the fix, copy buttons (MIT, Apache 2.0, GPL 3.0, MPL 2.0,
    with this year and the maker's handle filled in), the split-file advice with CC BY / CC BY-SA copy
    buttons, and "Check again". Check again re-reads the license without leaving the step, and a changed file
    clears the answer and the agreement tick.
  - **Elsewhere:** the Edit page and the adoption flow ask the same question when the server returns
    `license_question`.
- **Shown afterwards:**
  - **Project page:** "conditions" and "several" get a red-edged box above the handoff packet, with the
    added wording in full. The "Before you adopt" line says "custom (MIT with added conditions)" or
    "MIT, with a note".
  - **License record:** the license is named that way too. "What this means" says how Brainchild knows,
    and the wording is shown in its own box: "Added conditions (part of the license)" or "Maker's note in
    the license file (adds no conditions)".
- **Licensing guide:** the new section is `licenses.html#custom`, with links to the standard texts.
- **Local tests:** `test23` (39 checks) covers the owner's case, the wrong-fingerprint answer, plain
  matches, two licenses, the file found by name, unrecognised text and no file. It also covers the edit
  question and re-asking, re-recognising an old record, and the adopter's question. The older listing, edit,
  discussion and self-hosted suites still pass.

## Owner decision, 17 Nov: non-commercial art is allowed (never "no derivatives")

The owner chose option (a), with a second Opus instance's additions. **The rule now reads: code needs an
open license; art can be open, or non-commercial (but not "no derivatives").** Brainchild is
non-commercial by design, an NC project can still be adopted and continued (just not sold), and fear of
resale is the commonest reason makers hold back. Option (b), allowing NC art but not "up for adoption",
was turned down: it penalises the projects that most need a new owner.

**Done 17 Nov:**
- **Art licenses on offer:** CC BY 4.0, CC BY-SA 4.0, CC0, **CC BY-NC 4.0, CC BY-NC-SA 4.0**, and "Same as
  the code" (`ASSET_LICENSES` in `api/listings.js`; the step-4 select in `list.js`). No ND license is
  accepted, because art nobody may change stops a project being continued. The step-4 hint explains NC
  when it's chosen.
- **Labels:** cards show a "Non-commercial art" tag. The project page shows it in the line under the
  player, plus an "Art" row in Details ("… (non-commercial: can be changed, not sold)").
- **Browse filter "Commercial use allowed"** (License box): the code must be under a standard license (not
  Custom), and the art must be known and not NC. Older listings with no recorded art license are left out.
  The flag is `commercialOk` in `fromRow` (`common.js`).
- **Said at the moment of decision:** step 1 of adoption and the "Finish adopting" step, and the Relay task
  board when the winner has NC art, show one line (`BC.artNotice`): "Art is CC BY-NC-SA: you can change
  it, but not sell it, and changes stay under the same license." (BY-NC: "…but not sell it.") The board's
  data now carries `assets_license`.
- **The record and the AI rules:** the handoff rules tell AI tools that NC art may be changed but the
  project must not be sold. For NC-SA they add that changed art stays CC BY-NC-SA and that CC BY-SA art
  must not be mixed in (CC BY and CC0 files may sit alongside). The License record's "What this means"
  says the same. Like GPL code, NC-SA art can't be relicensed by an adopter; nothing lets anyone change
  someone else's art license.
- **Wording:** the house rules on the home and About pages now read as above. The licensing guide's art
  section lists both NC licenses and explains the grey areas (monetised videos, "pay what you want",
  Patreon), the BY-SA mixing problem, and why ND isn't accepted.
- **Tests:** `test23` now has 47 checks (ND and NC-ND refused, NC-SA accepted for adoption, the rules
  text, the list API and the license record). The browser check covered the filter, tag, project page,
  adoption line and form hint.

- **Art-license guidance reworded, 17 Nov (owner request).** CC BY 4.0 stays the form's default, but it is
  no longer "recommended". The licensing guide's art section has a "Which to choose" list, drops the
  "States it's irrevocable" tag from CC BY 4.0, and says all the art licenses are permanent. The step-4
  hint in `list.js` (`?v=25`) now reads "Not sure? CC BY 4.0 lets the most people continue the project…".

- **Fixed 17 Nov:** the step-4 hint now describes whichever art license is chosen (`ART_HINTS` in `list.js`), instead of one shared "Not sure?" line for every non-NC choice. Under it, a short guide to choosing is
  always shown (`ART_GUIDE`, owner's wording): the most reuse → CC BY 4.0; every version stays open → CC BY-SA;
  nobody may sell it → CC BY-NC-SA or CC BY-NC; no credit needed → CC0.

**Comes back to the owner if Brainchild ever makes money.** Ads, sponsorship, donations shown on project
pages, or paid features near NC projects could make hosting NC art "commercial advantage". As things
stand (free tiers, no ads) it's a non-issue. Before adding any of those, ask the owner how NC projects
should be treated.

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
- A mod's license covers only the modder's own files; the game's EULA still applies. Mods require `base_game`.
- Credit is never removed from lineage.

## Decided

- **Fonts (Option A):** Bricolage Grotesque for headings (weight 800), Atkinson Hyperlegible for body text,
  Martian Mono for code, and Silkscreen for pixel accents. Option B is held in reserve.
- **Background:** brushed metal with a faint chip-lattice pattern.
- **Hosting:** screenshots and builds are hosted on Brainchild (R2), not only in repos.
- **Art licenses (decided 17 Nov):** code needs an open license; art can be open or non-commercial
  (CC BY-NC, CC BY-NC-SA), never "no derivatives". See "Owner decision, 17 Nov: non-commercial art".
- **Logo (decided 15 Nov):** the owner's cradled-brain mark, used as the header logo (`site/img/favicon-180.png`)
  and as the favicon (`favicon-32.png`, `favicon-180.png`, `favicon-512.png`).

## Open (ask the owner; don't decide)

The hero background is still being decided (owner, 15 Nov).

- Hero background: the Julia, smoke or contour option from `HeroFractal`.
