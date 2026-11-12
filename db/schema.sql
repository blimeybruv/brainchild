-- Brainchild D1 schema (v1)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                 -- random id
  handle      TEXT NOT NULL UNIQUE,             -- shown as @handle
  email       TEXT UNIQUE,                      -- private, never shown
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  CHECK (kind <> 'Mod' OR base_game IS NOT NULL)
);
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
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who has maintained what, in order
CREATE TABLE IF NOT EXISTS lineage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'maintainer',  -- creator | maintainer | collaborator
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_lineage_project ON lineage (project_id, started_at);

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
