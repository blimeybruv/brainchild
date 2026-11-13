-- 0006: hosted browser builds. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
-- Files live in R2 under builds/<project id>/<build id>/. One build per project is 'active'.
CREATE TABLE IF NOT EXISTS builds (
  id           TEXT PRIMARY KEY,                 -- random
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,                    -- uploading | active | replaced | removed
  files        INTEGER NOT NULL DEFAULT 0,
  bytes        INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_builds_project ON builds (project_id, status);
