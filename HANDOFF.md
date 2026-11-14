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
     Not built: choosing and announcing the winner at month end, and reporting a proposal's text (the
     report form covers projects and comments only).
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
   Not in this queue and not built: the Mature gate from the Project mockup. Ratings and content notes are
   stored and shown in the project page's byline; the gate itself depends on the Open decision about
   German visitors.

**The queue above is finished (14 Nov).** What is left, for later batches:

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
- **Waiting on the owner:** the launch clean-up in "Owner requests, 14 Nov" (step 2: delisting sample
  projects, emptying the sample fallback, removing sample posts and proposals). The agent asks first and
  lists what will go.
- **Only if a listed game needs it:** cross-origin isolation headers on the builds Worker, for engines
  that use threads (some Godot and Unity web exports). No listed game needs them today.
- **Blocked on an Open decision:** the Mature gate.
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

- **Same gate for everyone:** build the click-through gate from the Project mockup for Mature projects.
  The notice lists the content notes, with a "Show it" button that remembers the choice for the session.
  Browse keeps hiding Mature projects unless "Show Mature projects" is ticked. No country detection and no
  ID checks.
- **Age label:** add the machine-readable label for German youth-protection software. Serve
  `/age-de.xml` labelling the site default as 0 (all ages) and Mature project pages (`/project.html?id=…`
  for Mature listings, or a path pattern if easier) as 18. Also add the `age-de-meta-label` meta tag
  on Mature project pages. Keep it simple; if a path-level label isn't possible for query-string pages,
  label at page level with the meta tag.
- **Fallback:** if a complaint ever arrives, hiding Mature listings for `CF-IPCountry: DE` is the
  fallback. Don't build it now.
- **"Historical symbols" is dropped (owner's decision):** it's removed from content notes in `list.js`
  and `edit.js` and from the About page's house rules. `api/listings.js` still accepts the old value so
  existing rows stay valid; don't show it anywhere.

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

## Open (ask the owner; don't decide)

- Logo: the C cradling a B, with the B drawn as a brain or as nerd glasses. The owner has their own sketches.
- Hero background: the Julia, smoke or contour option from `HeroFractal`.
