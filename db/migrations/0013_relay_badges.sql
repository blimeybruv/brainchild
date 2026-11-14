-- 0013: Relay rounds, part C (badges). Applied to brainchild-db and brainchild-db-preview on 14 Nov 2026.
CREATE TABLE IF NOT EXISTS relay_badges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id        INTEGER NOT NULL REFERENCES relay_rounds(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('helpful', 'wildcard')),   -- Most helpful contributor | Best wildcard
  user_id         TEXT NOT NULL REFERENCES users(id),
  contribution_id INTEGER NOT NULL REFERENCES relay_contributions(id) ON DELETE CASCADE,
  awarded_by      TEXT NOT NULL REFERENCES users(id),
  by_moderator    INTEGER NOT NULL DEFAULT 0,      -- 1 when a moderator awarded it because the maintainer awarded none
  awarded_at      TEXT NOT NULL,
  UNIQUE (round_id, kind)                          -- one of each per round
);
CREATE INDEX IF NOT EXISTS idx_relay_badges_user ON relay_badges (user_id);
