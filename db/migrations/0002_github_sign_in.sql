-- 0002: GitHub sign-in. Applied to brainchild-db and brainchild-db-preview on 13 Nov 2026.
ALTER TABLE users ADD COLUMN github_id INTEGER;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users (github_id);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash               TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  gh_access             TEXT,
  gh_access_expires_at  INTEGER,
  gh_refresh            TEXT,
  gh_refresh_expires_at INTEGER,
  gh_refresh_lock       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
