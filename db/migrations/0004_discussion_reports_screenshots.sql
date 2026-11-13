-- 0004: discussion, reports and moderation, screenshots. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
ALTER TABLE projects ADD COLUMN hidden_at TEXT;      -- set when a moderator removes the project; lineage and records are kept

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
