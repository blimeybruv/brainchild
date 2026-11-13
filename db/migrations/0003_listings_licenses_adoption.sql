-- 0003: listings, license records and adoption. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
ALTER TABLE projects ADD COLUMN intent TEXT;                               -- stay | leave (what the maker chose when listing)
ALTER TABLE projects ADD COLUMN repo_id INTEGER;                           -- GitHub's permanent repo id
ALTER TABLE projects ADD COLUMN repo_full_name TEXT;                       -- owner/name
ALTER TABLE projects ADD COLUMN rating TEXT NOT NULL DEFAULT 'everyone';   -- everyone | teen | mature
ALTER TABLE projects ADD COLUMN content_notes TEXT NOT NULL DEFAULT '[]';  -- JSON list, e.g. ["Violence","Historical symbols"]
ALTER TABLE projects ADD COLUMN assets_license TEXT;
ALTER TABLE projects ADD COLUMN name_rights TEXT;                          -- keep | continuation | rename (only when leaving)
ALTER TABLE projects ADD COLUMN open_to_transfer INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_repo_id ON projects (repo_id);

ALTER TABLE packets ADD COLUMN handoff_rules TEXT;                         -- the generated block for CLAUDE.md / AGENTS.md

ALTER TABLE lineage ADD COLUMN how TEXT;                                   -- created | forked | transferred
ALTER TABLE lineage ADD COLUMN repo_full_name TEXT;

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
