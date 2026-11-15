-- 0019: signals for moderators about vote rigging. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
-- Whether a linked GitHub or GitLab account has any public repositories or projects (1 yes, 0 no, NULL not known yet).
ALTER TABLE identities ADD COLUMN public_activity INTEGER;
-- A keyed hash of the network a vote, Relay entry or Relay ranking came from: the IPv4 /24 or IPv6 /64.
-- The raw address is never stored. The key is different for every vote and round, so hashes can't be
-- linked across them. Rows are deleted 30 days after that vote or round closes.
CREATE TABLE IF NOT EXISTS net_flags (
  kind       TEXT NOT NULL CHECK (kind IN ('vote', 'relay_entry', 'relay_rank')),
  scope      TEXT NOT NULL,                       -- the vote's month (2026-12) or the Relay round's month
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  net_hash   TEXT NOT NULL,
  expires_at TEXT NOT NULL,                       -- date after which the row is deleted
  PRIMARY KEY (kind, scope, user_id)
);
CREATE INDEX IF NOT EXISTS idx_net_flags_expiry ON net_flags (expires_at);
