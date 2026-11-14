-- 0014: blog proposals can be reported and removed. Applied to brainchild-db and brainchild-db-preview on 14 Nov 2026.
-- SQLite can't change a CHECK constraint, so reports is rebuilt with the same rows and ids.
ALTER TABLE proposals ADD COLUMN removed_at TEXT;          -- set when a moderator removes a proposal; its votes stop counting
ALTER TABLE moderation_actions ADD COLUMN proposal_id INTEGER;
CREATE TABLE reports_new (
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
  proposal_id     INTEGER REFERENCES proposals(id) ON DELETE CASCADE
);
INSERT INTO reports_new (id, target_type, project_id, comment_id, category, details, reporter_id, status, created_at, resolved_at, resolved_by, resolution_note, action_id)
  SELECT id, target_type, project_id, comment_id, category, details, reporter_id, status, created_at, resolved_at, resolved_by, resolution_note, action_id FROM reports;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id, created_at);
