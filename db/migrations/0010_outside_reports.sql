-- 0010: reports from people who aren't signed in. Applied to brainchild-db and brainchild-db-preview on 14 Nov 2026.
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
