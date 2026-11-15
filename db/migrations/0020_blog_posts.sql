-- 0020: blog posts written in the moderation area, pitches from members, and an edit log. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
ALTER TABLE posts ADD COLUMN created_at TEXT;
ALTER TABLE posts ADD COLUMN updated_at TEXT;
ALTER TABLE posts ADD COLUMN source_kind TEXT;          -- pitch | report | outside_report: where the text came from
ALTER TABLE posts ADD COLUMN source_id INTEGER;
-- author_id NULL means a site post, shown as "Brainchild". published_at NULL means a draft.

-- Who really created or changed a post, and when. Private: shown in the moderation area only.
CREATE TABLE IF NOT EXISTS post_edits (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id  INTEGER NOT NULL,                      -- no foreign key: the log outlives a deleted post
  title    TEXT NOT NULL,                         -- the title at the time, so the log still reads after a delete
  user_id  TEXT REFERENCES users(id),
  action   TEXT NOT NULL,                         -- create | edit | author | publish | unpublish | delete
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_edits_post ON post_edits (post_id, id);

-- "Pitch a post": a member's draft, waiting for a moderator.
CREATE TABLE IF NOT EXISTS pitches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  topic       TEXT NOT NULL CHECK (topic IN ('Community project','Handoff story','Guide','Site news')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',       -- open | drafted (a moderator made it a draft post) | declined
  note        TEXT,                               -- the moderator's note to the pitcher
  post_id     INTEGER,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pitches_status ON pitches (status, created_at);
