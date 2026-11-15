-- Brainchild D1 schema (v4: sign-in, listings, license records, adoption, discussion, reports, screenshots, blog votes). The full structure, for a new database.
-- Changes to an existing database are in db/migrations/, applied in order to both
-- brainchild-db and brainchild-db-preview.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                 -- random id
  handle      TEXT NOT NULL UNIQUE,             -- shown as @handle
  email       TEXT UNIQUE,                      -- unused: sign-in never asks GitHub for an email
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  github_id   INTEGER,                          -- GitHub's permanent numeric id (handles can change)
  avatar_url  TEXT,
  show_identities INTEGER NOT NULL DEFAULT 0    -- 1 = the public profile lists linked GitHub/GitLab accounts
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users (github_id);

-- Sign-in sessions. The cookie holds a random id; only its SHA-256 hash is stored here.
-- GitHub tokens are stored encrypted (see api/auth.js). Times are Unix seconds.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash               TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  gh_access             TEXT,
  gh_access_expires_at  INTEGER,                -- NULL = the token does not expire
  gh_refresh            TEXT,
  gh_refresh_expires_at INTEGER,
  gh_refresh_lock       INTEGER,                -- set while one request is refreshing the tokens
  gl_access             TEXT,                   -- the same for GitLab.com
  gl_access_expires_at  INTEGER,
  gl_refresh            TEXT,
  gl_refresh_lock       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,               -- url slug, e.g. moss-keeper
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('Game','Mod','App')),
  genre         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('adopt','help','test','active','archived')),
  base_game     TEXT,                           -- mods only
  tech          TEXT,
  browser       INTEGER NOT NULL DEFAULT 0,     -- 1 = plays/runs in browser
  license       TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  tone          TEXT NOT NULL DEFAULT '#4A4A52', -- placeholder colour until screenshots exist
  featured      INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  repo_url      TEXT,
  build_key     TEXT,                           -- R2 object key for the browser build / download
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  handed_off_at TEXT,
  intent        TEXT,                           -- stay | leave (what the maker chose when listing)
  repo_id       INTEGER,                        -- GitHub's permanent repo id
  repo_full_name TEXT,                          -- owner/name
  rating        TEXT NOT NULL DEFAULT 'everyone', -- everyone | teen | mature
  content_notes TEXT NOT NULL DEFAULT '[]',     -- JSON list, e.g. ["Violence","Historical symbols"]
  assets_license TEXT,
  name_rights   TEXT,                           -- keep | continuation | rename (only when leaving)
  open_to_transfer INTEGER NOT NULL DEFAULT 0,
  hidden_at     TEXT,                           -- set when a moderator removes the project; lineage and records are kept
  repo_host     TEXT,                           -- github | gitlab | selfhosted:<hostname>: repo_id is that site's number for the repo
  CHECK (kind <> 'Mod' OR base_game IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo ON projects (repo_host, repo_id);   -- a repo id is unique per host
CREATE INDEX IF NOT EXISTS idx_projects_filters ON projects (kind, status, genre);
CREATE INDEX IF NOT EXISTS idx_projects_base_game ON projects (base_game);

-- The handoff packet, one per project
CREATE TABLE IF NOT EXISTS packets (
  project_id     TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  works          TEXT,
  broken         TEXT,
  vision         TEXT,
  agent_context  TEXT,                          -- CLAUDE.md / AGENTS.md contents
  provenance     TEXT,                          -- JSON: [{part, how}]
  handoff_rules  TEXT,                          -- the generated block for CLAUDE.md / AGENTS.md
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who has maintained what, in order
CREATE TABLE IF NOT EXISTS lineage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'maintainer',  -- creator | maintainer | collaborator
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,                             -- set when someone else takes over; rows are never deleted
  how         TEXT,                             -- created | forked | transferred
  repo_full_name TEXT,
  repo_host   TEXT NOT NULL DEFAULT 'github'    -- github | gitlab
);
CREATE INDEX IF NOT EXISTS idx_lineage_project ON lineage (project_id, started_at);

-- One row per release. Rows are only ever added: an earlier release can't be taken back.
CREATE TABLE IF NOT EXISTS license_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,              -- 1 = when first listed or handed off
  kind           TEXT NOT NULL,                 -- listing | handoff | adoption | relicense
  repo_full_name TEXT NOT NULL,
  commit_sha     TEXT NOT NULL,
  spdx_id        TEXT,                          -- NULL = a license file GitHub doesn't recognise
  license_sha256 TEXT NOT NULL,                 -- fingerprint of the license text
  license_key    TEXT NOT NULL,                 -- where the stored copy is in R2
  license_path   TEXT,
  assets_license TEXT,
  name_rights    TEXT,
  recorded_by    TEXT REFERENCES users(id),
  recorded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  repo_host      TEXT NOT NULL DEFAULT 'github',   -- github | gitlab
  UNIQUE (project_id, version)
);

-- Discussion, reports, moderation and screenshots
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,   -- replies are one level deep
  body        TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT,
  removed_by  TEXT                                  -- author | moderator
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments (user_id, created_at);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type     TEXT NOT NULL CHECK (target_type IN ('project','comment','proposal')),
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  comment_id      INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,                    -- sexual | rating | malware | license | harass | spam | other
  details         TEXT,
  reporter_id     TEXT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'open',     -- open | actioned | dismissed
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT REFERENCES users(id),
  resolution_note TEXT,
  action_id       INTEGER,
  proposal_id     INTEGER REFERENCES proposals(id) ON DELETE CASCADE   -- target_type 'proposal': a blog vote proposal
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id, created_at);

-- The statement of reasons for each removal. Rows are kept even if the content is later deleted.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type        TEXT NOT NULL,
  project_id         TEXT NOT NULL,
  comment_id         INTEGER,
  affected_user_id   TEXT,
  action             TEXT NOT NULL,                 -- remove
  ground             TEXT,                          -- terms (house rules) | illegal
  category           TEXT,
  reasons            TEXT NOT NULL,
  automated          INTEGER NOT NULL DEFAULT 0,    -- always 0: a person decides
  moderator_id       TEXT NOT NULL,
  report_id          INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  appeal_text        TEXT,
  appeal_at          TEXT,
  appeal_outcome     TEXT,                          -- restored | upheld
  appeal_note        TEXT,
  appeal_resolved_at TEXT,
  proposal_id        INTEGER                        -- target_type 'proposal'
);
CREATE INDEX IF NOT EXISTS idx_actions_user ON moderation_actions (affected_user_id, created_at);

CREATE TABLE IF NOT EXISTS screenshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  uploaded_by  TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, sha256)
);

-- Hosted browser builds. Files live in R2 under builds/<project id>/<build id>/. One build per project is 'active'.
CREATE TABLE IF NOT EXISTS builds (
  id           TEXT PRIMARY KEY,                 -- random
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,                    -- uploading | active | previous (kept for rollback) | replaced | removed
  files        INTEGER NOT NULL DEFAULT 0,
  bytes        INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,
  version      INTEGER,                          -- 1, 2, 3 ... per project, set when the build goes live
  commit_sha   TEXT                              -- the repo's latest commit when the upload started
);
CREATE INDEX IF NOT EXISTS idx_builds_project ON builds (project_id, status);

-- One row per save: which fields changed and when (never the old text). Rating changes also
-- keep their old and new values, which only moderators see.
CREATE TABLE IF NOT EXISTS project_changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  changed_at TEXT NOT NULL,
  fields     TEXT NOT NULL,                     -- JSON list of field names
  rating_old TEXT,
  rating_new TEXT,
  notes_old  TEXT,
  notes_new  TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_changes_project ON project_changes (project_id, id);

-- One row per repo snapshot we asked Software Heritage to archive. Only the public repo address is sent.
CREATE TABLE IF NOT EXISTS archive_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  license_version INTEGER NOT NULL,
  repo_url        TEXT NOT NULL,
  swh_id          INTEGER,                        -- Software Heritage's id for the request
  status          TEXT NOT NULL,                  -- queued | requested | archived | failed
  swhid           TEXT,                           -- the archived snapshot's permanent id
  attempts        INTEGER NOT NULL DEFAULT 0,
  requested_at    TEXT NOT NULL,
  checked_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_requests_project ON archive_requests (project_id, status);

-- Reports from people who aren't signed in
CREATE TABLE IF NOT EXISTS outside_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,                   -- the same seven categories as signed-in reports
  url             TEXT NOT NULL,                   -- the page being reported (this site or a game's address)
  project_id      TEXT,                            -- filled in when the address points at a project
  details         TEXT NOT NULL,
  reply_to        TEXT,                            -- optional, private, deleted when the case closes
  status          TEXT NOT NULL DEFAULT 'open',    -- open | actioned | handled | dismissed
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT REFERENCES users(id),
  resolution_note TEXT,
  action_id       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outside_reports_status ON outside_reports (status, created_at);

-- Relay rounds
CREATE TABLE IF NOT EXISTS relay_rounds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  month           TEXT NOT NULL UNIQUE,            -- e.g. 2026-12; a round lasts one calendar month
  status          TEXT NOT NULL,                   -- entry | voting | running | review | closed | not_run (fewer than 4 entries)
  winner_entry_id INTEGER,
  carried         INTEGER NOT NULL DEFAULT 0,      -- 1 once a not-run round's entries have been carried into the next
  created_at      TEXT NOT NULL,
  decided_at      TEXT,
  closed_at       TEXT
);

CREATE TABLE IF NOT EXISTS relay_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id     INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  pitch        TEXT NOT NULL,                      -- what a month of help would get done
  created_at   TEXT NOT NULL,                      -- also the last tie-breaker: earlier entry wins
  carried_from INTEGER,                            -- the round this entry was carried over from, if any
  UNIQUE (round_id, user_id),                      -- one project per person per round
  UNIQUE (round_id, project_id)
);

-- Each entrant ranks three other entries: rank 1 = 3 points, 2 = 2 points, 3 = 1 point.
CREATE TABLE IF NOT EXISTS relay_votes (
  round_id  INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  voter_id  TEXT NOT NULL REFERENCES users(id),
  entry_id  INTEGER NOT NULL REFERENCES relay_entries(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL CHECK (rank IN (1, 2, 3)),
  PRIMARY KEY (round_id, voter_id, rank),
  UNIQUE (round_id, voter_id, entry_id)
);

-- Community project proposals and votes (one vote per user per month)
CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id),
  goal        TEXT NOT NULL,
  month       TEXT NOT NULL,                    -- e.g. 2026-12
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT                              -- set when a moderator removes it; its votes stop counting
);
CREATE INDEX IF NOT EXISTS idx_proposals_month ON proposals (month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_project_month ON proposals (project_id, month);  -- once per project per month

CREATE TABLE IF NOT EXISTS votes (
  user_id     TEXT NOT NULL REFERENCES users(id),
  month       TEXT NOT NULL,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  topic        TEXT NOT NULL CHECK (topic IN ('Community project','Handoff story','Guide','Site news')),
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  author_id    TEXT REFERENCES users(id),
  published_at TEXT
);

-- Relay rounds, part B: task board, claims, contributions and junk flags.
CREATE TABLE IF NOT EXISTS relay_tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,                   -- short label, e.g. Bug, Art, Balance
  title      TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL,
  removed_at TEXT                             -- set when the maintainer takes a task off the board
);
CREATE INDEX IF NOT EXISTS idx_relay_tasks_round ON relay_tasks (round_id);

-- "I'm working on this": so people don't spend a month on the same task.
CREATE TABLE IF NOT EXISTS relay_claims (
  task_id    INTEGER NOT NULL REFERENCES relay_tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);

-- A contribution is a pull request on the winner's repo, checked on GitHub when it is submitted.
CREATE TABLE IF NOT EXISTS relay_contributions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id        INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id),
  task_id         INTEGER REFERENCES relay_tasks(id),   -- NULL = wildcard (the contributor's own idea)
  pr_number       INTEGER NOT NULL,
  pr_url          TEXT NOT NULL,
  pr_title        TEXT NOT NULL,
  pr_opened_at    TEXT NOT NULL,
  note            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  flag_reason     TEXT,                       -- no_change | spam | no_effort | ignored  (set by the maintainer)
  flag_note       TEXT,
  flagged_by      TEXT REFERENCES users(id),
  flagged_at      TEXT,
  flag_outcome    TEXT,                       -- upheld (the PR doesn't count) | cleared
  flag_reasons    TEXT,                       -- the moderator's statement of reasons
  flag_decided_by TEXT REFERENCES users(id),
  flag_decided_at TEXT,
  action_id       INTEGER,                    -- moderation_actions row written when a flag is upheld
  UNIQUE (round_id, pr_number)
);
CREATE INDEX IF NOT EXISTS idx_relay_contrib_user ON relay_contributions (user_id, round_id);

-- Relay rounds, part C: badges awarded when a round is reviewed.
CREATE TABLE IF NOT EXISTS relay_badges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id        INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('helpful', 'wildcard')),   -- Most helpful contributor | Best wildcard
  user_id         TEXT NOT NULL REFERENCES users(id),
  contribution_id INTEGER NOT NULL REFERENCES relay_contributions(id) ON DELETE CASCADE,
  awarded_by      TEXT NOT NULL REFERENCES users(id),
  by_moderator    INTEGER NOT NULL DEFAULT 0,      -- 1 when a moderator awarded it because the maintainer awarded none
  awarded_at      TEXT NOT NULL,
  UNIQUE (round_id, kind)                          -- one of each per round
);
CREATE INDEX IF NOT EXISTS idx_relay_badges_user ON relay_badges (user_id);

-- Linked sign-ins: one Brainchild account can have a GitHub and a GitLab.com sign-in.
CREATE TABLE IF NOT EXISTS identities (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  provider_user_id    TEXT NOT NULL,                 -- the provider's permanent numeric id, as text
  handle              TEXT NOT NULL,                 -- the username there (it can change; refreshed at each sign-in)
  avatar_url          TEXT,
  provider_created_at TEXT,                          -- when the account was made there, if the provider says (a signal for moderators)
  linked_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON identities (user_id);

-- Accounts merged by a moderator (both had been used, so they couldn't be joined automatically).
CREATE TABLE IF NOT EXISTS account_merges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id  TEXT NOT NULL,                     -- the account that was folded in (it no longer exists)
  from_handle   TEXT NOT NULL,
  into_user_id  TEXT NOT NULL REFERENCES users(id),
  moderator_id  TEXT NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL,                     -- why, for example "asked through the contact page on 15 Nov"
  moved         TEXT NOT NULL,                     -- JSON: how many rows of each kind moved
  merged_at     TEXT NOT NULL
);

-- Self-hosted GitLab: codes committed to brainchild-verify.txt to prove push access.
CREATE TABLE IF NOT EXISTS verify_codes (
  code       TEXT PRIMARY KEY,                    -- what the person commits to brainchild-verify.txt
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_host  TEXT NOT NULL,                       -- selfhosted:<hostname>
  repo_path  TEXT NOT NULL,                       -- group/project, lower case
  created_at INTEGER NOT NULL,                    -- Unix seconds; a code must be committed within 7 days
  used_at    INTEGER                              -- set when a listing, handoff or adoption used it
);
CREATE INDEX IF NOT EXISTS idx_verify_codes_user ON verify_codes (user_id, created_at);
