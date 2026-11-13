-- Brainchild D1 schema (v4: sign-in, listings, license records, adoption, discussion, reports, screenshots). The full structure, for a new database.
-- Changes to an existing database are in db/migrations/, applied in order to both
-- brainchild-db and brainchild-db-preview.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                 -- random id
  handle      TEXT NOT NULL UNIQUE,             -- shown as @handle
  email       TEXT UNIQUE,                      -- unused: sign-in never asks GitHub for an email
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  github_id   INTEGER,                          -- GitHub's permanent numeric id (handles can change)
  avatar_url  TEXT
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
  gh_refresh_lock       INTEGER                 -- set while one request is refreshing the tokens
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
  CHECK (kind <> 'Mod' OR base_game IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo_id ON projects (repo_id);
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
  repo_full_name TEXT
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
  target_type     TEXT NOT NULL CHECK (target_type IN ('project','comment')),
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
  action_id       INTEGER
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
  appeal_resolved_at TEXT
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

-- Community project proposals and votes (one vote per user per month)
CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id),
  goal        TEXT NOT NULL,
  month       TEXT NOT NULL,                    -- e.g. 2026-12
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proposals_month ON proposals (month);

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
