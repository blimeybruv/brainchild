-- 0008: Software Heritage archive requests. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
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
