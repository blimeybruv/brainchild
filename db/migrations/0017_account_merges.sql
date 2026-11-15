-- 0017: a record of accounts merged by a moderator. Applied to brainchild-db and brainchild-db-preview on 15 Nov 2026.
CREATE TABLE IF NOT EXISTS account_merges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id  TEXT NOT NULL,                     -- the account that was folded in (it no longer exists)
  from_handle   TEXT NOT NULL,
  into_user_id  TEXT NOT NULL REFERENCES users(id),
  moderator_id  TEXT NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL,                     -- why, for example "asked through the contact page on 15 Nov"
  moved         TEXT NOT NULL,                     -- JSON: how many rows of each kind moved
  merged_at     TEXT NOT NULL
);
