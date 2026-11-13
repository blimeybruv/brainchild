-- 0007: editing a project page. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
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
