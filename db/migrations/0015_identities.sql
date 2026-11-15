-- 0015: linked sign-ins (GitHub and GitLab.com) for one Brainchild account. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
CREATE TABLE IF NOT EXISTS identities (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  provider_user_id    TEXT NOT NULL,                 -- the provider's permanent numeric id, as text
  handle              TEXT NOT NULL,                 -- the username there (it can change; refreshed at each sign-in)
  avatar_url          TEXT,
  provider_created_at TEXT,                          -- when the account was made there, if the provider says (a signal for moderators)
  linked_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON identities (user_id);
-- Everyone who has signed in with GitHub so far.
INSERT OR IGNORE INTO identities (user_id, provider, provider_user_id, handle, avatar_url, linked_at)
  SELECT id, 'github', CAST(github_id AS TEXT), handle, avatar_url, created_at FROM users WHERE github_id IS NOT NULL;
-- GitLab tokens, kept per session exactly like the GitHub ones (encrypted, never sent to the browser).
ALTER TABLE sessions ADD COLUMN gl_access TEXT;
ALTER TABLE sessions ADD COLUMN gl_access_expires_at INTEGER;
ALTER TABLE sessions ADD COLUMN gl_refresh TEXT;
ALTER TABLE sessions ADD COLUMN gl_refresh_lock INTEGER;
-- Whether the public profile lists the person's linked GitHub and GitLab accounts (off unless they opt in).
ALTER TABLE users ADD COLUMN show_identities INTEGER NOT NULL DEFAULT 0;
